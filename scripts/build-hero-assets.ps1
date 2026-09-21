param(
    [ValidateSet('driver','home','all')][string]$Asset = 'all',
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Blender)) { throw "Blender not found: $Blender" }
$assetScripts = if ($Asset -eq 'driver') { @('build-dad-driver.py') } elseif ($Asset -eq 'home') { @('build-home-props.py') } else { @('build-dad-driver.py','build-home-props.py') }
foreach ($assetScript in $assetScripts) {
    & $Blender --background --python-exit-code 1 --python (Join-Path $PSScriptRoot $assetScript)
    if ($LASTEXITCODE -ne 0) { throw "Blender build failed: $assetScript" }
}
