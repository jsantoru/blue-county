param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$gameDirectory = $PSScriptRoot
Set-Location -LiteralPath $gameDirectory
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer, then run this launcher again.' }
if (-not (Test-Path -LiteralPath (Join-Path $gameDirectory 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $gameDirectory 'dist/index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}
$gameUrl = 'http://127.0.0.1:5180/'
$alreadyRunning = $false
try {
    $response = Invoke-WebRequest -Uri $gameUrl -TimeoutSec 2
    if ($response.Content -match '<title>Blue County') { $alreadyRunning = $true }
    else { throw 'Port 5180 is occupied by another application.' }
} catch {
    if ($_.Exception.Message -like '*occupied*') { throw }
}
if (-not $alreadyRunning) {
    $viteEntry = Join-Path $gameDirectory 'node_modules/vite/bin/vite.js'
    $nodeExecutable = (Get-Command node.exe).Source
    $viteArguments = @(('"{0}"' -f $viteEntry),'preview','--host','127.0.0.1','--port','5180','--strictPort')
    $process = Start-Process -FilePath $nodeExecutable -ArgumentList $viteArguments -WorkingDirectory $gameDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gameDirectory 'server.log') -RedirectStandardError (Join-Path $gameDirectory 'server-error.log') -PassThru
    Set-Content -LiteralPath (Join-Path $gameDirectory '.server-pid') -Value $process.Id
    $isReady = $false
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { if ((Invoke-WebRequest -Uri $gameUrl -TimeoutSec 1).StatusCode -eq 200) { $isReady = $true; break } } catch { }
    }
    if (-not $isReady) { throw 'Local server did not start. See server-error.log.' }
}
Write-Host "Blue County is running at $gameUrl"
if (-not $NoBrowser) { Start-Process $gameUrl }
