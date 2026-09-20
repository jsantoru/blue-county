param([string]$Blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $Blender)) { throw "Blender not found: $Blender. Pass -Blender <path>." }
& $Blender --background --python-exit-code 1 --python (Join-Path $PSScriptRoot 'export-car.py')
if ($LASTEXITCODE -ne 0) { throw 'Car export failed.' }
