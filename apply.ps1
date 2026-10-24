# Re-apply the dsh-cost bundles into the installed profile package.
#
# The profile declares `dsh-cost` as a `link:` dependency on this folder, so a
# `pnpm install` makes node_modules/dsh-cost a symlink here and this script is
# then unnecessary. While it is still a plain copy, run this after editing lib/.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-cost'
if (-not (Test-Path $target)) {
  throw "installed package not found: $target"
}
if ((Get-Item $target).LinkType -eq 'SymbolicLink') {
  Write-Host "$target is a link to $here - nothing to copy."
  exit 0
}
Copy-Item (Join-Path $here 'lib\index.js') (Join-Path $target 'lib\index.js') -Force
Copy-Item (Join-Path $here 'lib\client.js') (Join-Path $target 'lib\client.js') -Force
Copy-Item (Join-Path $here 'cordis.patch.yml') (Join-Path $target 'cordis.patch.yml') -Force
Copy-Item (Join-Path $here 'package.json') (Join-Path $target 'package.json') -Force
Write-Host "patched: $target"
Write-Host "restart DeepSeek Harness to load the host route."
