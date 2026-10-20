param([string]$GamePath = 'D:\Games\Warcraft III', [string]$StateDirectory, [switch]$Update)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
$runtime = if ($env:AMAI_RUNTIME) { $env:AMAI_RUNTIME } else { $config.runtime }
$deployment = Join-Path $runtime 'deployment.json'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
if (-not $StateDirectory) { $StateDirectory = Join-Path $repo 'runtime' }
function Write-Deployment($status,$message) {
    @{ status = $status; message = $message; at = [DateTime]::UtcNow.ToString('o'); pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath ($deployment + '.tmp') -Encoding utf8
    Move-Item -LiteralPath ($deployment + '.tmp') -Destination $deployment -Force
}
try {
    Write-Deployment 'waiting' 'Новая сборка будет установлена сразу после выхода из Warcraft III.'
    while ($games = @(Get-Process -Name 'Warcraft III' -ErrorAction SilentlyContinue)) { $games | Wait-Process }
    if ($Update -and (Test-Path -LiteralPath (Join-Path $StateDirectory 'installation.json'))) {
        # Restore verified originals first, preserving the pre-fork rollback
        # across updates. Install.ps1 refuses unrelated external modifications.
        & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $GamePath -StateDirectory $StateDirectory -Restore
    }
    & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $GamePath -StateDirectory $StateDirectory
    Write-Deployment 'installed' 'Глобальные скрипты AMAI и четыре расовых AI заменены; исходные файлы сохранены для отката. Следующий матч — проверка телеметрии.'
} catch { Write-Deployment 'failed' $_.Exception.Message; throw }
