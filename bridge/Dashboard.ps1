param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$runtime = 'D:\ChatGPT\Cache\AMAI-LLM'
$pidFile = Join-Path $runtime 'monitor.pid'
$node = 'D:\ChatGPT\Tools\node\node.exe'
$entry = Join-Path $PSScriptRoot 'monitor-server.mjs'
$existing = $null
if (Test-Path -LiteralPath $pidFile) {
    $monitorPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$monitorPid"
    if ($existing -and -not $existing.CommandLine.Contains($entry)) { $existing = $null }
}
if ($Stop) { if ($existing) { Stop-Process -Id $existing.ProcessId; Remove-Item -LiteralPath $pidFile }; return }
if (-not $existing) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $process = Start-Process -FilePath $node -ArgumentList $entry -WorkingDirectory (Split-Path $PSScriptRoot -Parent) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'monitor-stdout.log') -RedirectStandardError (Join-Path $runtime 'monitor-stderr.log') -PassThru
    Set-Content -LiteralPath $pidFile -Value $process.Id
}
Write-Output 'http://127.0.0.1:8765'
