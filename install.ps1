# 把本仓库链接进 DSH profile（重装系统 / 换机后一条命令恢复）。
#
#   .\install.ps1                 # 默认 profile = desktop，用 junction
#   .\install.ps1 -Profile web    # 指定 profile
#   .\install.ps1 -Copy           # 当 node_modules\dsh-cost 是实体目录时，复制文件而不是建链接
#
# 执行策略受限时：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
param(
  [string]$Profile = 'desktop',
  [switch]$Copy,
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $NodePath) {
  $found = Get-ChildItem "$env:USERPROFILE\.dsh\dsh-runtimes" -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\dependencies\node\bin\node.exe' } |
    Select-Object -First 1 -ExpandProperty FullName
  if ($found) { $NodePath = $found }
}

if (-not $NodePath -or -not (Test-Path $NodePath)) {
  throw '找不到 DSH 运行时的 node.exe。先启动一次 DSH，或用 -NodePath 指定。'
}

$arguments = @((Join-Path $repo 'install.mjs'), '--profile', $Profile)
if ($Copy) { $arguments += '--copy' }

& $NodePath @arguments
exit $LASTEXITCODE
