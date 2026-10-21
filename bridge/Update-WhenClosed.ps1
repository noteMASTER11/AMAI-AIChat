$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\ChatGPT\Temp'
$env:TMP = $env:TEMP
$repo = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
# Install-WhenClosed publishes waiting/installed state and preserves original backups.
& (Join-Path $PSScriptRoot 'Install-WhenClosed.ps1') -Update
$main = Join-Path $PSScriptRoot 'main.mjs'
$lock = Join-Path $config.mailbox 'bridge.lock'
if (Test-Path -LiteralPath $lock) {
    $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid"
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($main)) {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$bridgePid" | Where-Object { $_.Name -eq 'codex.exe' -and $_.CommandLine -match 'app-server' })
        Stop-Process -Id $bridgePid -Force
        foreach ($child in $children) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    } elseif ($process) { throw 'Bridge lock points to an unrelated process; automatic restart stopped.' }
}
Start-Process -FilePath 'D:\ChatGPT\Tools\node\node.exe' -ArgumentList @($main) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $config.runtime 'stdout.log') -RedirectStandardError (Join-Path $config.runtime 'stderr.log')
Write-Output 'Scripts updated; bridge restarted. Start a new local melee match.'
