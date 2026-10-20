param([switch]$Loopback, [switch]$Doctor)
$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\ChatGPT\Temp'
$env:TMP = $env:TEMP
$node = 'D:\ChatGPT\Tools\node\node.exe'
if ($Doctor) { & $node (Join-Path $PSScriptRoot 'doctor.mjs'); exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot 'Install.ps1') -PrepareOnly
$lock = Join-Path (Split-Path $PSScriptRoot -Parent) 'runtime\mailbox\bridge.lock'
if (Test-Path -LiteralPath $lock) {
    $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid"
    if ($existing -and $existing.CommandLine.Contains((Join-Path $PSScriptRoot 'main.mjs'))) { Write-Output "Bridge is already running (PID $bridgePid)."; return }
}
$arguments = @((Join-Path $PSScriptRoot 'main.mjs'))
if ($Loopback) { $arguments += '--loopback' }
& $node @arguments
exit $LASTEXITCODE
