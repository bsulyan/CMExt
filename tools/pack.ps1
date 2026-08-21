# pack.ps1 — Fabrique le ZIP a charger dans Chrome ou a deposer sur le
# Chrome Web Store.
#
# Le depot contient des choses qui n'ont rien a faire dans une extension : les
# dumps de pages CardMarket (plusieurs Mo), le README, le .git. On ne zippe donc
# pas le dossier, on recopie une liste explicite dans dist\ puis on la compresse.
#
# Le ZIP doit contenir manifest.json A SA RACINE : c'est ce que Chrome cherche.
# Compresser le dossier parent produit une archive que le Store refuse.
#
# Usage :  powershell -ExecutionPolicy Bypass -File tools\pack.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$manifest = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$version = $manifest.version
$stage = Join-Path $root "dist\cmext-$version"
$zip = Join-Path $root "dist\cmext-$version.zip"

# Repart d'une aire propre : un fichier supprime du depot ne doit pas survivre
# dans le ZIP parce qu'il trainait dans dist\.
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
if (Test-Path $zip) { Remove-Item -Force $zip }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Ce qui part dans l'extension, et rien d'autre.
$sources = @("manifest.json", "src", "styles", "_locales")
foreach ($item in $sources) {
  if (-not (Test-Path $item)) { throw "source introuvable : $item" }
  Copy-Item -Recurse -Force -Path $item -Destination $stage
}

# Filet : tout ce que le manifeste declare doit exister dans l'aire de montage.
# Un script renomme et oublie dans le manifeste donne une extension qui se
# charge mais dont une feature est morte, sans le moindre message.
$declared = @()
foreach ($entry in $manifest.content_scripts) {
  $declared += $entry.js
  $declared += $entry.css
}
$declared += $manifest.options_ui.page

foreach ($file in $declared) {
  if (-not $file) { continue }
  $staged = Join-Path $stage $file
  if (-not (Test-Path $staged)) { throw "declare dans le manifeste mais absent du paquet : $file" }
}

# Verification inverse : un fichier embarque que le manifeste ne declare pas.
# Ce n'est pas une erreur (options.js et options.css sont charges par la page
# d'options, pas par le manifeste), juste de quoi reperer un oubli.
$packed = Get-ChildItem -Recurse -File $stage
$known = $declared + @("manifest.json", "src/options/options.js", "src/options/options.css")
$known = $known | ForEach-Object { $_ -replace "/", "\" }
foreach ($file in $packed) {
  $rel = $file.FullName.Substring($stage.Length + 1)
  if ($rel -like "_locales\*") { continue }
  if ($known -notcontains $rel) { Write-Warning "embarque sans etre declare : $rel" }
}

# Compression a la main plutot que Compress-Archive : celui-ci ecrit les
# separateurs Windows ("src\content\common.js") dans les noms d'entrees, alors
# que la spec ZIP impose "/". Chrome charge parfois l'archive quand meme, mais
# le Chrome Web Store la rejette ou l'aplatit. On pose donc les entrees soi-meme.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($zip, "Create")
try {
  foreach ($file in $packed) {
    $entryName = $file.FullName.Substring($stage.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file.FullName, $entryName) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Output "$zip"
Write-Output "$($packed.Count) fichier(s), $size Ko"
