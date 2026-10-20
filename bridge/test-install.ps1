$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path 'D:\ChatGPT\Temp' ('amai-install-test-' + [Guid]::NewGuid().ToString('N'))
$game = Join-Path $fixture 'Game'
$scripts = Join-Path $game '_retail_\Scripts'
$state = Join-Path $fixture 'State'
$verification = Join-Path $fixture 'Verification'
$previousRuntime = $env:AMAI_RUNTIME
New-Item -ItemType Directory -Path $scripts,$verification -Force | Out-Null
$env:AMAI_RUNTIME = $verification
@{ method = 'observed-game-ack'; session = '123456789'; seq = 2; game = '3.0.1' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $verification 'transport-verified.json')
foreach ($name in @('common.ai','Blizzard.j')) { Set-Content -LiteralPath (Join-Path $scripts $name) -Value ('original-' + $name) }
$original = (Get-FileHash -LiteralPath (Join-Path $scripts 'common.ai')).Hash
# External process inventory is the only mocked boundary. All copies, hashes,
# manifests, refusal and restore logic use real files in this isolated fixture.
function Get-Process { param($Name,$ErrorAction) return @() }
try {
    & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $game -StateDirectory $state
    if ((Get-FileHash -LiteralPath (Join-Path $scripts 'common.ai')).Hash -eq $original) { throw 'Install did not replace fixture script.' }
    & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $game -StateDirectory $state -Restore
    if ((Get-FileHash -LiteralPath (Join-Path $scripts 'common.ai')).Hash -ne $original) { throw 'Restore did not recover original bytes.' }
    if (Test-Path -LiteralPath (Join-Path $state 'installation.json')) { throw 'Restore must retire the manifest to allow reinstall.' }
    & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $game -StateDirectory $state
    Add-Content -LiteralPath (Join-Path $scripts 'common.ai') -Value 'external change'
    $refused = $false
    try { & (Join-Path $PSScriptRoot 'Install.ps1') -GamePath $game -StateDirectory $state -Restore } catch { $refused = $_.Exception.Message -like '*changed after installation*' }
    if (-not $refused) { throw 'Restore overwrote an external modification.' }
    Write-Output 'PASS: fixture install, byte-exact restore, reinstall, modified-file refusal.'
} finally {
    if ($null -eq $previousRuntime) { Remove-Item Env:AMAI_RUNTIME -ErrorAction SilentlyContinue } else { $env:AMAI_RUNTIME = $previousRuntime }
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith('D:\ChatGPT\Temp\amai-install-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture cleanup target.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
