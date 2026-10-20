$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\ChatGPT\Temp'
$env:TMP = $env:TEMP
$env:LC_ALL = 'C'
$env:LC_CTYPE = 'C'
$env:LANG = 'C'
$repo = Split-Path $PSScriptRoot -Parent
$perl = 'D:\ChatGPT\Tools\StrawberryPerl-5.42.3.1\perl\bin'
if (-not (Test-Path -LiteralPath (Join-Path $perl 'perl.exe'))) { throw 'Portable Strawberry Perl is missing.' }
$env:PATH = $perl + ';' + $env:PATH
# The upstream build removes REFORGED/tmp. Verify its absolute location first.
$expected = [IO.Path]::GetFullPath((Join-Path $repo 'REFORGED\tmp'))
if (-not $expected.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid build target.' }
Push-Location $repo
try {
    & '.\MakeREFORGED.bat' 1
    if ($LASTEXITCODE -ne 0) { throw 'AMAI compilation failed.' }
} finally { Pop-Location }
