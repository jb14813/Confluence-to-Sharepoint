param(
  [Parameter(Mandatory = $true)][string]$SourceArchive,
  [Parameter(Mandatory = $true)][string]$BuildRoot,
  [string]$SourceSha256 = 'fbc648d47049c621c14a58c22f02b29d5f4fd52bc1383906b8e10972a68db28a'
)
$ErrorActionPreference = 'Stop'
$sdkSourceHash = $SourceSha256
if ((Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sdkSourceHash) { throw 'Unexpected sdkjs source archive' }
if (Test-Path -LiteralPath $BuildRoot) { throw 'Choose a new empty build directory; this script does not remove existing files' }
New-Item -ItemType Directory -Path $BuildRoot | Out-Null
$sdkBuildAbsolute = (Resolve-Path -LiteralPath $BuildRoot).Path
$sourcePython = if ($env:PYTHON) { $env:PYTHON } elseif ($IsWindows) { 'python' } else { 'python3' }
& $sourcePython (Join-Path $PSScriptRoot 'extract-source.py') $SourceArchive $sdkBuildAbsolute
if ($LASTEXITCODE -ne 0) { throw 'Source extraction failed' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package.json'),(Join-Path $PSScriptRoot 'npm-shrinkwrap.json') -Destination (Join-Path $sdkBuildAbsolute 'build')
Push-Location (Join-Path $sdkBuildAbsolute 'build')
try {
  npm ci --ignore-scripts --include=optional
  if ($LASTEXITCODE -ne 0) { throw 'Pinned build dependency installation failed' }
  $env:PRODUCT_VERSION = '9.3.0.133'
  $env:BUILD_NUMBER = '1'
  $env:APP_COPYRIGHT = 'Copyright (C) Ascensio System SIA 2012-2026. All rights reserved'
  $env:PUBLISHER_URL = 'https://www.onlyoffice.com/'
  $env:COMPANY_NAME = 'onlyoffice'
  node node_modules/grunt-cli/bin/grunt compile-word --map --level=SIMPLE
  if ($LASTEXITCODE -ne 0) { throw 'Official Word SDK compilation failed' }
} finally { Pop-Location }
$sdkExpected = @{
  'sdk-all-min.js' = '9cc8575a2cf1d632d50d1e0d6ec892d3844131d140fa2389f15077e49b030ef1'
  'sdk-all.js' = 'd31721c91813f9f776fa6da10fe1e146d8c48fdeb5793e4213a47e2db9070282'
}
foreach ($sdkOutput in $sdkExpected.Keys) {
  $sdkOutputPath = Join-Path $sdkBuildAbsolute "deploy/sdkjs/word/$sdkOutput"
  if ((Get-FileHash -LiteralPath $sdkOutputPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sdkExpected[$sdkOutput]) { throw "Unexpected output hash: $sdkOutput" }
  Get-Item -LiteralPath $sdkOutputPath | Select-Object FullName,Length
}
