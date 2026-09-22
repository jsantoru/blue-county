param(
    [string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Blender)) { throw "Blender not found: $Blender" }
& $Blender --background --python-exit-code 1 --python (Join-Path $PSScriptRoot 'build-club-cars.py')
if ($LASTEXITCODE -ne 0) { throw 'Lug Nuts car export failed.' }
