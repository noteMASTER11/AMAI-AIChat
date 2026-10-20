param([switch]$Loopback, [switch]$Doctor)
$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\ChatGPT\Temp'
$env:TMP = $env:TEMP
$node = 'D:\ChatGPT\Tools\node\node.exe'
if ($Doctor) { & $node (Join-Path $PSScriptRoot 'doctor.mjs'); exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot 'Install.ps1') -PrepareOnly
$arguments = @((Join-Path $PSScriptRoot 'main.mjs'))
if ($Loopback) { $arguments += '--loopback' }
& $node @arguments
exit $LASTEXITCODE
