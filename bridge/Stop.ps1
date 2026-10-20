$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$lock = Join-Path $repo 'runtime\mailbox\bridge.lock'
if (-not (Test-Path -LiteralPath $lock)) { Write-Output 'Bridge is not running.'; return }
$bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid"
if ($process -and $process.CommandLine.Contains((Join-Path $PSScriptRoot 'main.mjs'))) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$bridgePid"
    # Windows Stop-Process cannot deliver SIGINT to a hidden console. Explicitly
    # terminate only this verified bridge's owned App Server before its parent.
    foreach ($child in $children) {
        if ($child.Name -eq 'codex.exe' -and $child.CommandLine.Contains('app-server')) { Stop-Process -Id $child.ProcessId }
    }
    Stop-Process -Id $bridgePid
    Remove-Item -LiteralPath $lock
    Write-Output 'Bridge stopped.'
} else { throw 'Lock PID does not belong to this bridge; no process was stopped.' }
