# =====================================================================
#  Builds the CrazyGames version of PolyWeave:  "CrazyGames Build" folder + "CrazyGames Build.zip"
#  (upload the zip on developer.crazygames.com). Run it again after every game update.
#  Same game files as polyweave.org; the differences are made here:
#   - index.html says it's the CrazyGames build (window.PW_PLATFORM, see js/platform.js and js/crazygames.js)
#     and loads the CrazyGames SDK
#   - three.js is included (tools/vendor/three.min.js) instead of coming from a CDN
#   - fixed version stamp instead of a new one every load (CrazyGames' servers can cache the files)
#   - no app install (manifest / service worker), no server or private files
#  Usage (PowerShell, in the game folder):  powershell -ExecutionPolicy Bypass -File tools\build-crazygames.ps1
# =====================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'CrazyGames Build'
$zip = Join-Path $root 'CrazyGames Build.zip'

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Force (Join-Path $out 'js\vehicles') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $out 'assets') | Out-Null

# game scripts (everything index.html loads; not the vehicle template)
Get-ChildItem -LiteralPath (Join-Path $root 'js') -Filter *.js -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName (Join-Path $out 'js') }
Get-ChildItem -LiteralPath (Join-Path $root 'js\vehicles') -Filter *.js -File | Where-Object { $_.Name -ne '_template.js' } |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName (Join-Path $out 'js\vehicles') }
Copy-Item -LiteralPath (Join-Path $root 'tools\vendor\three.min.js') (Join-Path $out 'js\three.min.js')
Copy-Item -LiteralPath (Join-Path $root 'style.css') $out
Copy-Item -LiteralPath (Join-Path $root 'assets\icon-192.png') (Join-Path $out 'assets')
Copy-Item -LiteralPath (Join-Path $root 'assets\f1_car.bin') (Join-Path $out 'assets')   # (the F1 car: the owner's model, cleaned up - js/f1.js)

# index.html for CrazyGames
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'))
$stamp = Get-Date -Format 'yyyyMMddHHmm'
$swaps = @(
  @('<link rel="manifest" href="manifest.webmanifest">', ''),
  @('<title>PolyWeave</title>', "<title>PolyWeave</title>`n<script>window.PW_PLATFORM = 'crazygames';</script>`n<script src=`"https://sdk.crazygames.com/crazygames-sdk-v3.js`"></script>"),
  @('<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>', '<script src="js/three.min.js"></script>'),
  @('const v = Date.now();', "const v = '$stamp';")
)
foreach ($s in $swaps) {
  if (-not $html.Contains($s[0])) { throw "index.html changed: could not find  $($s[0])  (update tools\build-crazygames.ps1)" }
  $html = $html.Replace($s[0], $s[1])
}
[IO.File]::WriteAllText((Join-Path $out 'index.html'), $html, (New-Object Text.UTF8Encoding $false))

# every script index.html loads must be in the build
$m = [regex]::Match($html, "const VEHICLES = \[([^\]]*)\]")
$veh = [regex]::Matches($m.Groups[1].Value, "'([^']+)'") | ForEach-Object { 'js/vehicles/' + $_.Groups[1].Value }
$f = [regex]::Match($html, "const files = \[([^\]]*)\]")
$names = [regex]::Matches($f.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value } | Where-Object { -not $_.EndsWith('/') }   # ('js/vehicles/' + name: checked above)
# car models converted from real ones (assets/*.js that index.html loads)
foreach ($n in @($names)) { if ($n.StartsWith('assets/')) { Copy-Item -LiteralPath (Join-Path $root ($n + '.js')) (Join-Path $out 'assets') } }
$missing = @()
foreach ($n in @($names) + @($veh)) { if (-not (Test-Path -LiteralPath (Join-Path $out ($n + '.js')))) { $missing += $n } }
if ($missing.Count) { throw "Missing from the build: $($missing -join ', ')" }

# nothing private or server-side may end up in it
$bad = Get-ChildItem -LiteralPath $out -Recurse -File | Where-Object { $_.Name -match '^(accounts\.json|leaderboard\.json|polyweave\.db.*|server\.js|db\.js|admin\.js|config\.json|recorder\.js)$' }
if ($bad) { throw "Private / server file in the build: $($bad.Name -join ', ')" }

Compress-Archive -Path (Join-Path $out '*') -DestinationPath $zip
$files = Get-ChildItem -LiteralPath $out -Recurse -File
$size = ($files | Measure-Object Length -Sum).Sum
Write-Host ("CrazyGames build ready: {0} files, {1:N2} MB (zip {2:N2} MB), version {3}" -f $files.Count, ($size / 1MB), ((Get-Item -LiteralPath $zip).Length / 1MB), $stamp)
Write-Host "Upload: $zip"
