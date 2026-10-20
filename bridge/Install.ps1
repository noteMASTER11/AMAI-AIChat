param([string]$GamePath = 'D:\Games\Warcraft III', [string]$StateDirectory, [switch]$PrepareOnly, [switch]$Restore)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
$verificationRoot = if ($env:AMAI_RUNTIME) { $env:AMAI_RUNTIME } else { $config.runtime }
if (-not $StateDirectory) { $StateDirectory = Join-Path $repo 'runtime' }
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
if (-not $StateDirectory.StartsWith('D:\ChatGPT\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation state must be under D:\ChatGPT.' }
New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
$mailbox = [IO.Path]::GetFullPath($config.mailbox)
if (-not $mailbox.StartsWith('D:\ChatGPT\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Mailbox must be under D:\ChatGPT.' }
New-Item -ItemType Directory -Path $mailbox -Force | Out-Null
$profilePath = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Warcraft III'
foreach ($parent in @($profilePath, (Join-Path $profilePath 'CustomMapData'))) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $link = Join-Path $parent 'AMAI-LLM'
    if (Test-Path -LiteralPath $link) {
        $item = Get-Item -LiteralPath $link -Force
        if ($item.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath([string]$item.Target) -ne $mailbox) { throw "Existing mailbox path points elsewhere: $link" }
    } else { New-Item -ItemType Junction -Path $link -Target $mailbox | Out-Null }
}
if ($PrepareOnly) { Write-Output "Mailbox prepared: $mailbox"; return }
if (Get-Process -Name 'Warcraft III' -ErrorAction SilentlyContinue) { throw 'Warcraft III is running. Finish the match and exit the game before replacing scripts.' }
$target = Join-Path $GamePath '_retail_\Scripts'
if (-not (Test-Path -LiteralPath $target)) { throw 'Warcraft Scripts directory does not exist.' }
$manifestPath = Join-Path $StateDirectory 'installation.json'
if ($Restore) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath($manifest.target) -ne [IO.Path]::GetFullPath($target)) { throw 'Installation target mismatch.' }
    foreach ($file in $manifest.files) {
        $destination = Join-Path $target $file.name
        if ((Get-FileHash -LiteralPath $destination).Hash -notin @($file.installedHash,$file.originalHash)) { throw "File changed after installation: $destination" }
        if ((Get-FileHash -LiteralPath (Join-Path $manifest.backup $file.name)).Hash -ne $file.originalHash) { throw "Backup checksum mismatch: $($file.name)" }
    }
    foreach ($file in $manifest.files) { Copy-Item -LiteralPath (Join-Path $manifest.backup $file.name) -Destination (Join-Path $target $file.name) }
    foreach ($file in $manifest.files) {
        if ((Get-FileHash -LiteralPath (Join-Path $target $file.name)).Hash -ne $file.originalHash) { throw "Restore validation failed: $($file.name)" }
    }
    Remove-Item -LiteralPath $manifestPath
    Write-Output 'Original AMAI files restored.'
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $verificationRoot 'transport-verified.json'))) { throw 'Run the probe map and obtain an observed game acknowledgement before global installation.' }
if (Test-Path -LiteralPath $manifestPath) { throw 'An installation manifest already exists; use -Restore before reinstalling.' }
$backup = Join-Path $StateDirectory ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$files = @('common.ai', 'Blizzard.j') | ForEach-Object {
    $name = $_
    $source = Join-Path $repo ('Scripts\REFORGED\' + $name)
    $destination = Join-Path $target $name
    if (-not (Test-Path -LiteralPath $source) -or -not (Test-Path -LiteralPath $destination)) { throw "Missing script: $name" }
    Copy-Item -LiteralPath $destination -Destination (Join-Path $backup $name)
    [PSCustomObject]@{ name = $name; originalHash = (Get-FileHash -LiteralPath $destination).Hash; installedHash = (Get-FileHash -LiteralPath $source).Hash }
}
# Save rollback data before the first game file changes.
@{ target = $target; backup = $backup; files = @($files) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8
try {
    foreach ($file in $files) {
        Copy-Item -LiteralPath (Join-Path $repo ('Scripts\REFORGED\' + $file.name)) -Destination (Join-Path $target $file.name)
        if ((Get-FileHash -LiteralPath (Join-Path $target $file.name)).Hash -ne $file.installedHash) { throw "Copy validation failed: $($file.name)" }
    }
} catch {
    $installError = $_
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $backup $file.name) -Destination (Join-Path $target $file.name) }
    foreach ($file in $files) {
        if ((Get-FileHash -LiteralPath (Join-Path $target $file.name)).Hash -ne $file.originalHash) { throw "Rollback validation failed: $($file.name)" }
    }
    Remove-Item -LiteralPath $manifestPath
    throw $installError
}
Write-Output 'AMAI LLM scripts installed. Start the bridge, then type -llm on in a local melee match.'
