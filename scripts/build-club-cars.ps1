param(
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe',
    [ValidateSet('', 'lou', 'chris', 'craig', 'ed')][string]$Member = ''
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Blender)) { throw "Blender not found: $Blender" }
if ($Member) {
    & $Blender --background --python-exit-code 1 --python (Join-Path $PSScriptRoot 'build-club-cars.py') -- --member $Member
} else {
    & $Blender --background --python-exit-code 1 --python (Join-Path $PSScriptRoot 'build-club-cars.py')
}
if ($LASTEXITCODE -ne 0) { throw 'Lug Nuts car export failed.' }
