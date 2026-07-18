param(
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:LOCALAPPDATA "ptgactivewear-dev-state-$Port"
$site = Join-Path $env:LOCALAPPDATA "ptgactivewear-dev-assets-$Port"
$localRoot = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'

foreach ($path in @($state, $site)) {
  $resolved = [System.IO.Path]::GetFullPath($path)
  if (-not $resolved.StartsWith($localRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to manage a local-development path outside LOCALAPPDATA: $resolved"
  }
}

New-Item -ItemType Directory -Force -Path $state | Out-Null
Remove-Item -LiteralPath $site -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $site | Out-Null

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
$bundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
if ($npx) {
  $runner = $npx.Source
  $runnerPrefix = @('--yes', 'wrangler')
} elseif (Test-Path -LiteralPath $bundledPnpm) {
  $env:PATH = "$bundledNode;$env:PATH"
  $runner = $bundledPnpm
  $runnerPrefix = @('dlx', 'wrangler')
} else {
  throw 'Node.js with npx, or the bundled Codex runtime, is required.'
}

Push-Location $repo
try {
  & $runner @runnerPrefix d1 migrations apply ptgactivewear-catalog --local --persist-to $state
  if ($LASTEXITCODE -ne 0) {
    # Older media migrations reference the original catalogue records. A fresh
    # local database therefore needs this minimal catalogue before retrying.
    Write-Host 'Bootstrapping the local catalogue required by legacy migrations...'
    & $runner @runnerPrefix d1 execute ptgactivewear-catalog --local --persist-to $state --file seed\bootstrap-catalogue.sql
    if ($LASTEXITCODE -ne 0) { throw 'Local D1 bootstrap catalogue failed.' }
    & $runner @runnerPrefix d1 migrations apply ptgactivewear-catalog --local --persist-to $state
    if ($LASTEXITCODE -ne 0) { throw 'Local D1 migration failed after bootstrap.' }
  }

  & $runner @runnerPrefix d1 execute ptgactivewear-catalog --local --persist-to $state --file seed\seed-products.sql
  if ($LASTEXITCODE -ne 0) { throw 'Local product seed failed.' }

  Copy-Item -LiteralPath 'css', 'js', 'admin', 'photos' -Destination $site -Recurse -Force
  Copy-Item -LiteralPath 'index.html', 'shop.html', 'product.html', 'about.html', 'contact.html', 'cart.html', 'order-success.html', 'robots.txt', 'sitemap.xml', 'favicon.png' -Destination $site -Force

  Write-Host "Starting PTG Activewear locally at http://127.0.0.1:$Port"
  & $runner @runnerPrefix dev --port $Port --persist-to $state --assets $site `
    --var CATALOG_SOURCE:d1 `
    --var INVENTORY_ENFORCEMENT:d1 `
    --var ENVIRONMENT:development `
    --var LOW_STOCK_THRESHOLD:5 `
    --var CHECKOUT_ENABLED:true
} finally {
  Pop-Location
}
