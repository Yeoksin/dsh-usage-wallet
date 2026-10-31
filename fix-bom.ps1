<#
.SYNOPSIS
  修复旧版 install.ps1（0.16.0-qwen.1）造成的 DSH 启动失败（profile 的 package.json 被写成带 BOM 的 UTF-8）。

.DESCRIPTION
  症状：DSH 启动时弹窗「DeepSeek Harness is unavailable … Unexpected token '\uFEFF' … is not valid JSON」。

  原因：旧版 install.ps1 用 Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
  改 %USERPROFILE%\.dsh\profiles\desktop\package.json，PS 5.1 会写入 UTF-8 BOM
  （EF BB BF），Node 的 JSON.parse 不认 BOM，宿主读 profile 清单时直接崩溃。

  本脚本把 BOM 去掉，并校验 JSON 可解析；改之前照样留一份 .bak 备份。

  用法（普通 PowerShell 窗口，不是 DSH 里）：
    powershell -ExecutionPolicy Bypass -File fix-bom.ps1
#>
[CmdletBinding()]
param(
  [string]$ProfilePackage = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json')
)

$ErrorActionPreference = 'Stop'

function Write-Ok([string]$t)   { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Err2([string]$t) { Write-Host "  [x] $t" -ForegroundColor Red }
function Write-Info([string]$t) { Write-Host "  $t" -ForegroundColor Gray }

Write-Host "`n==> 检查 $ProfilePackage" -ForegroundColor Cyan
if (-not (Test-Path $ProfilePackage)) {
  Write-Err2 '找不到 profile 的 package.json，路径不对？'
  exit 1
}

$bytes = [IO.File]::ReadAllBytes($ProfilePackage)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF

if (-not $hasBom) {
  Write-Ok '没有 BOM，不需要修复。'
} else {
  $backup = "$ProfilePackage.bomfix-" + (Get-Date).ToString('yyyyMMdd-HHmmss')
  Copy-Item $ProfilePackage $backup
  Write-Ok "已备份：$backup"
  $body = New-Object byte[] ($bytes.Length - 3)
  [Array]::Copy($bytes, 3, $body, 0, $body.Length)
  [IO.File]::WriteAllBytes($ProfilePackage, $body)
  Write-Ok '已去掉 UTF-8 BOM'
}

# 校验：不含 BOM 且 JSON 可解析
$after = [IO.File]::ReadAllBytes($ProfilePackage)
if ($after.Length -ge 3 -and $after[0] -eq 0xEF -and $after[1] -eq 0xBB -and $after[2] -eq 0xBF) {
  Write-Err2 '仍然带 BOM，请手动用编辑器把文件另存为「UTF-8（无 BOM）」。'
  exit 1
}
try {
  $json = [Text.Encoding]::UTF8.GetString($after) | ConvertFrom-Json
  Write-Ok 'JSON 可以正常解析'
} catch {
  Write-Err2 "JSON 仍然无法解析：$($_.Exception.Message)"
  Write-Info '可以改用 install.ps1 写下的备份：package.json.bak-<时间戳>'
  exit 1
}

# 顺便检查有没有同时启用了会冲突的两个插件
$bundles = @()
if ($json.PSObject.Properties.Name -contains 'dsh' -and $json.dsh -and $json.dsh.profile -and $json.dsh.profile.bundles) {
  $bundles = @($json.dsh.profile.bundles)
}
$hasOld = $bundles -contains '@dougen/dsh-deepseek-usage'
$hasNew = $bundles -contains 'dsh-usage-wallet'
if ($hasOld -and $hasNew) {
  Write-Err2 'bundles 里同时有原版和本分支，二者路由冲突，请二选一（建议保留 dsh-usage-wallet）。'
} elseif ($hasNew) {
  Write-Ok 'bundles 里已启用 dsh-usage-wallet'
} elseif ($hasOld) {
  Write-Info 'bundles 里是原版插件（未启用本分支）'
}

Write-Host "`n现在可以重新打开 DeepSeek Harness 了。`n" -ForegroundColor Cyan