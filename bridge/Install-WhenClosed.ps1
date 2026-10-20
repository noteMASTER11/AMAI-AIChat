$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
$deployment = Join-Path $config.runtime 'deployment.json'
New-Item -ItemType Directory -Path $config.runtime -Force | Out-Null
function Write-Deployment($status,$message) {
    @{ status = $status; message = $message; at = [DateTime]::UtcNow.ToString('o'); pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath ($deployment + '.tmp') -Encoding utf8
    Move-Item -LiteralPath ($deployment + '.tmp') -Destination $deployment -Force
}
try {
    Write-Deployment 'waiting' 'Новая сборка будет установлена сразу после выхода из Warcraft III.'
    while ($games = @(Get-Process -Name 'Warcraft III' -ErrorAction SilentlyContinue)) { $games | Wait-Process }
    & (Join-Path $PSScriptRoot 'Install.ps1')
    Write-Deployment 'installed' 'Глобальные common.ai и Blizzard.j заменены; исходные файлы сохранены для отката. Следующий матч — проверка телеметрии.'
} catch { Write-Deployment 'failed' $_.Exception.Message; throw }
