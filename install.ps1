<#
.SYNOPSIS
  DSH 插件安装脚本：dsh-usage-wallet（通用余额 / 用量侧边栏：阿里云代金券、小米 MiMo、DeepSeek 等）。

.DESCRIPTION
  把 dsh-usage-wallet 装进 DSH 的 profile 插件目录，并把包名写进
  dsh.profile.bundles（自动移除会冲突的原版 @dougen/dsh-deepseek-usage）。
  可重复执行：已装过会就地升级。

  旧版（0.16.0-qwen.2 起）修了 qwen.1 的一个致命 bug：旧版在 Windows PowerShell 5.1 下用
  `Set-Content -Encoding UTF8` 改写 profile 的 package.json 会写入 BOM，导致 DSH
  启动时报 "Unexpected token '﻿' ... is not valid JSON"。现在改为字节级写入
  UTF-8（无 BOM），并在落盘后自检，失败自动回滚备份。

  推荐用法（双击 install.bat 也行，它只是调用本脚本）：

    powershell -ExecutionPolicy Bypass -File install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1 -TgzPath C:\path\to\pkg.tgz
    powershell -ExecutionPolicy Bypass -File install.ps1 -Offline   # 同目录有 tgz 时用，不联网

  联网下载依次尝试 curl.exe（Win10 1803+ 自带）、TLS1.2 下的 Invoke-WebRequest、
  .NET HttpClient —— Windows PowerShell 5.1 的 IWR 常因 TLS/代理配置直接失败。

.PARAMETER TgzPath
  已经下载好的 .tgz 路径（离线/内网用，跳过下载）。

.PARAMETER Force
  不询问确认。

.PARAMETER NoBundles
  只拷文件，不改 bundles。
#>
[CmdletBinding()]
param(
  [string]$TgzPath = '',
  [switch]$Offline,
  [switch]$Force,
  [switch]$NoBundles
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageName    = 'dsh-usage-wallet'
$PackageVersion = '0.17.3'
# 需要从 bundles 里清理的旧名字（上游原版 + 本插件之前的包名），避免两个插件抢同一批路由/槽位
$LegacyPackageNames = @('@dougen/dsh-deepseek-usage', 'dsh-deepseek-usage-qwen')
$Repo           = 'Yeoksin/dsh-usage-wallet'
$AssetName      = "$PackageName-$PackageVersion.tgz"
$AssetUrl       = "https://github.com/$Repo/releases/download/v$PackageVersion/$AssetName"
$ShaUrl         = "https://github.com/$Repo/releases/download/v$PackageVersion/assets.sha256"

function Write-Step([string]$t)  { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Write-Ok([string]$t)    { Write-Host "  [OK] $t" -ForegroundColor Green }
function Write-Warn2([string]$t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Write-Err([string]$t)   { Write-Host "  [x] $t" -ForegroundColor Red }

# ---------------------------------------------------------------- 1. 环境检查
Write-Step '检查环境'

$profileDir  = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$profilePkg  = Join-Path $profileDir 'package.json'
$nodeModules = Join-Path $profileDir 'node_modules'

if (-not (Test-Path $profilePkg)) {
  Write-Err "没找到 DSH profile：$profilePkg"
  Write-Err '请先安装并至少启动一次 DeepSeek Harness 桌面版。'
  exit 1
}
Write-Ok "DSH profile：$profileDir"

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  Write-Err '系统里没有 tar.exe（Windows 10 1803+ 自带）。请升级系统，或手动解压 tgz。'
  exit 1
}

$dshRunning = @(Get-Process -Name 'DeepSeek Harness','deepseek-harness' -ErrorAction SilentlyContinue)
if ($dshRunning.Count -gt 0) {
  Write-Warn2 'DSH 正在运行：安装后请【完全退出并重新打开 DSH】（托盘也要退出）。'
}

# ---------------------------------------------------------------- 2. 拿到压缩包
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-usage-qwen-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$tgz = Join-Path $tempRoot $AssetName

try {
  # 离线模式：优先用脚本同目录的 tgz（双击 install.bat 时走的就是这条路，完全不需要联网）
  if ($Offline -and $TgzPath -eq '') {
    $sibling = Join-Path $PSScriptRoot $AssetName
    if (Test-Path $sibling) { $TgzPath = $sibling }
    else { throw "离线模式：请把 $AssetName 和 install.ps1 放在同一个文件夹里再运行（当前查找 $sibling）。" }
  }

  if ($TgzPath -ne '') {
    Write-Step "使用本地压缩包：$TgzPath"
    if (-not (Test-Path $TgzPath)) { throw "找不到文件：$TgzPath" }
    Copy-Item $TgzPath $tgz -Force
  }
  else {
    Write-Step "下载 $PackageName $PackageVersion"
    $downloaded = $false

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
      & $curl.Source -L --fail --silent --show-error --retry 2 -o $tgz $AssetUrl
      if ($LASTEXITCODE -eq 0 -and (Test-Path $tgz) -and (Get-Item $tgz).Length -gt 0) { $downloaded = $true }
    }

    if (-not $downloaded) {
      try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $AssetUrl -OutFile $tgz -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 120
        if ((Test-Path $tgz) -and (Get-Item $tgz).Length -gt 0) { $downloaded = $true }
      }
      catch { }
    }

    if (-not $downloaded) {
      try {
        Add-Type -AssemblyName System.Net.Http
        $client = New-Object System.Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromMinutes(3)
        $bytes = $client.GetByteArrayAsync($AssetUrl).GetAwaiter().GetResult()
        [IO.File]::WriteAllBytes($tgz, $bytes)
        $downloaded = $true
      }
      catch { }
    }

    if (-not $downloaded) {
      throw ("下载失败。请手动下载后重跑：`n    $AssetUrl`n  然后：powershell -ExecutionPolicy Bypass -File install.ps1 -TgzPath <下载的文件>")
    }

    if ($curl) {
      try {
        $shaFile = Join-Path $tempRoot 'assets.sha256'
        & $curl.Source -L --fail --silent -o $shaFile $ShaUrl
        if ($LASTEXITCODE -eq 0 -and (Test-Path $shaFile)) {
          $line = (Get-Content $shaFile | Where-Object { $_ -match [regex]::Escape($AssetName) } | Select-Object -First 1)
          if ($line) {
            $want = ($line -split '\s+')[0].ToLower()
            $have = (Get-FileHash -Path $tgz -Algorithm SHA256).Hash.ToLower()
            if ($want -ne $have) { throw "SHA-256 不匹配（期望 $want，实际 $have），文件可能被改动，已中止。" }
            Write-Ok 'SHA-256 校验通过'
          }
        }
        else { Write-Warn2 '跳过 SHA-256 校验（取不到校验文件）' }
      }
      catch {
        if ($_.Exception.Message -like 'SHA-256*') { throw }
        Write-Warn2 '跳过 SHA-256 校验（取不到校验文件）'
      }
    }
  }

  Write-Ok ('压缩包 {0:N0} 字节' -f (Get-Item $tgz).Length)

  # -------------------------------------------------------------- 3. 解压
  Write-Step "解压到 $nodeModules\$PackageName"
  $extract = Join-Path $tempRoot 'extract'
  New-Item -ItemType Directory -Path $extract | Out-Null
  & tar -xzf $tgz -C $extract
  if ($LASTEXITCODE -ne 0) { throw '解压失败（tar 返回非 0）' }

  $staged = Join-Path $extract 'package'
  if (-not (Test-Path (Join-Path $staged 'package.json'))) { throw '压缩包结构异常：找不到 package/package.json' }

  if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null }
  foreach ($legacy in $LegacyPackageNames) {
    $legacyDir = Join-Path $nodeModules $legacy
    if (Test-Path $legacyDir) {
      Write-Warn2 "移除旧版本目录：$legacyDir"
      Remove-Item $legacyDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $target = Join-Path $nodeModules $PackageName
  if (Test-Path $target) {
    Write-Warn2 "移除旧版本：$target"
    Remove-Item $target -Recurse -Force
  }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $staged '*') -Destination $target -Recurse -Force
  Write-Ok ('插件文件已就位（{0} 个）' -f (Get-ChildItem $target -Recurse -File | Measure-Object).Count)

  # -------------------------------------------------------------- 4. 改 bundles
  if (-not $NoBundles) {
    Write-Step '更新 dsh.profile.bundles'
    $backup = "$profilePkg.bak-" + (Get-Date).ToString('yyyyMMdd-HHmmss')
    Copy-Item $profilePkg $backup
    Write-Ok "已备份：$backup"

    $json = Get-Content $profilePkg -Raw | ConvertFrom-Json
    # StrictMode 下取不存在的属性会抛错，所以统一用「属性名列表 + 取索引」判断，不用 $obj.a.b.c。
    $jsonNames = @($json.PSObject.Properties | Select-Object -ExpandProperty Name)
    if ($jsonNames -notcontains 'dsh') {
      throw "profile 的 package.json 里没有 dsh 段，无法自动改写；请手动把 `"$PackageName`" 加进 dsh.profile.bundles。"
    }
    $dshNode = $json.dsh
    $dshNames = @($dshNode.PSObject.Properties | Select-Object -ExpandProperty Name)
    if ($dshNames -notcontains 'profile') {
      throw "profile 的 package.json 里没有 dsh.profile 段，请手动把 `"$PackageName`" 加进 dsh.profile.bundles。"
    }
    $profileNode = $dshNode.profile
    $profileNames = @($profileNode.PSObject.Properties | Select-Object -ExpandProperty Name)
    if ($profileNames -notcontains 'bundles') {
      throw "profile 的 package.json 里没有 dsh.profile.bundles，请手动把 `"$PackageName`" 加进 bundles。"
    }

    $bundles = [System.Collections.Generic.List[object]]::new()
    foreach ($b in $profileNode.bundles) { $bundles.Add($b) }
    $removed = @()
    foreach ($legacy in $LegacyPackageNames) {
      if ($bundles.Contains($legacy)) { [void]$bundles.Remove($legacy); $removed += $legacy }
    }
    $hadOld = $removed.Count -gt 0
    if (-not $bundles.Contains($PackageName)) { $bundles.Add($PackageName) }
    $json.dsh.profile.bundles = [object[]]$bundles.ToArray()

    if ($null -ne $json.dependencies) {
      # Set-StrictMode -Version Latest 下，dependencies 为空对象时
      # `$obj.PSObject.Properties.Name` 会抛「在此对象上找不到与参数名称 Name 匹配的属性」，
      # 所以整体用 @() 包一层再比较。
      $depNames = @($json.dependencies.PSObject.Properties | Select-Object -ExpandProperty Name)
      foreach ($legacy in $LegacyPackageNames) {
        if ($depNames -contains $legacy) { $json.dependencies.PSObject.Properties.Remove($legacy) }
      }
      $json.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue "file:node_modules/$PackageName" -Force
    }
    else {
      # 没有 dependencies 段时补一个（StrictMode 下不能直接对不存在的属性赋值）
      $json | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue ([pscustomobject]@{}) -Force
      $json.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue "file:node_modules/$PackageName" -Force
    }

    # 关键：必须写「UTF-8 无 BOM」。Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
    # 会加 BOM（EF BB BF），Node 的 JSON.parse 不认，DSH 启动时读 profile 清单直接崩——
    # 这是 旧版 0.16.0-qwen.1 的 bug，这里改成字节级写入 + 落盘前自检 + 失败自动回滚。
    $text = $json | ConvertTo-Json -Depth 32
    # 1) 先在内存里验证：能解析、bundles 里有新包
    try { $null = $text | ConvertFrom-Json } catch { throw "生成的 JSON 无法解析，已放弃写入（原文件未改动）：$($_.Exception.Message)" }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = $utf8NoBom.GetBytes($text)
    # 2) 落盘
    [IO.File]::WriteAllBytes($profilePkg, $bytes)
    # 3) 落盘后自检：无 BOM、可解析、条目正确；任何一项不满足就回滚到备份
    $onDisk = [IO.File]::ReadAllBytes($profilePkg)
    $bom = $onDisk.Length -ge 3 -and $onDisk[0] -eq 0xEF -and $onDisk[1] -eq 0xBB -and $onDisk[2] -eq 0xBF
    $ok = $false
    if (-not $bom) {
      try {
        $check = [Text.Encoding]::UTF8.GetString($onDisk) | ConvertFrom-Json
        $checkBundles = @($check.dsh.profile.PSObject.Properties['bundles'].Value)
        $ok = ($checkBundles -contains $PackageName)
      } catch { $ok = $false }
    }
    if (-not $ok) {
      Copy-Item $backup $profilePkg -Force
      throw "写入后自检失败（BOM=$bom），已自动还原备份 $backup 。请把上面这段输出发给维护者。"
    }
    if ($hadOld) { Write-Ok ("已从 bundles 移除旧条目：" + ($removed -join ', ')) }
    Write-Ok "已把 $PackageName 加入 bundles（UTF-8 无 BOM，可解析自检通过）"
  }
}
catch {
  Write-Err $_.Exception.Message
  exit 1
}
finally {
  Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 5. 收尾
Write-Step '完成'
Write-Host @"

  下一步（必须做）：
    1. 完全退出 DeepSeek Harness（托盘图标也要退出），重新打开；
    2. 设置 → 插件 → 找到 $PackageName → 详情页底部
       「阿里云 AccessKey（查代金券余额）」填入 AccessKey ID / Secret 并保存；
       RAM 子账号需要 AliyunBSSReadOnlyAccess（资源范围选「账号级别」）；
    3. 侧边栏底部卡片出现 ¥ 金额即成功。

  卸载：从 profile 的 package.json 的 dsh.profile.bundles 移除 $PackageName，
        删掉 node_modules\$PackageName，重启 DSH。

"@ -ForegroundColor Gray

if ($dshRunning.Count -gt 0) { Write-Host '  提醒：检测到 DSH 正在运行，别忘了彻底重启它。' -ForegroundColor Yellow }