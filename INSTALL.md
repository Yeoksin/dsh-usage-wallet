# 安装说明（给朋友看的简版）

## 前提

- 已装 **DeepSeek Harness 桌面版**（Windows 10 1803 及以上），且模型接的是 `qwen-token-plan`（阿里云百炼）；
- 有一对**阿里云 AccessKey**（免费；RAM 子账号 + `AliyunBSSReadOnlyAccess` 只读权限最安全）。

## 装完看不到卡片？先看这里

- 插件详情页标题应是 `dsh-deepseek-usage-qwen`、版本 `0.16.0-qwen.4`，「包含的组件」也是这个名字；
  如果显示成 `@dougen/dsh-deepseek-usage` +「未运行」，说明你装的是 qwen.1 / qwen.2——重跑最新 `install.ps1`，再完全重启 DSH。
- 完整排查清单（含用命令确认 bundles 是否写入）见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)。
## 已经装过旧版、DSH 打不开怎么办

旧版安装脚本（`0.16.0-qwen.1`）在 Windows PowerShell 5.1 下会把 profile 的 `package.json` 写成带 BOM 的 UTF-8，
DSH 会报 `Unexpected token '﻿' ... is not valid JSON` 并打不开。**数据没丢**，按下面修：

```powershell
# 方法一：用修复脚本（推荐）
powershell -ExecutionPolicy Bypass -File .ix-bom.ps1

# 方法二：手动去掉 BOM
$p = "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
$b = [IO.File]::ReadAllBytes($p)
if ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { [IO.File]::WriteAllBytes($p, $b[3..($b.Length-1)]) }
```

然后重新打开 DSH，再用新版 `install.ps1` 重装一次即可。

## 一键安装（推荐）

1. 打开 <https://github.com/Yeoksin/dsh-deepseek-usage-qwen/releases/latest>；
2. 把 **`install.bat` 和 `install.ps1` 下载到同一个文件夹**（如果浏览器没自动加后缀，改名为 `install.bat` / `install.ps1`）；
3. **双击 `install.bat`**（或右键 → 以 PowerShell 运行 `install.ps1`）；
4. 看到 `==> 完成` 就好了，然后**完全退出 DSH（托盘也要退出）再打开**。

脚本会自动：

- 下载压缩包并核对 SHA-256；
- 解压到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-deepseek-usage-qwen`；
- 备份并修改 `profiles\desktop\package.json`：把 `dsh-deepseek-usage-qwen` 加进 `dsh.profile.bundles`，并移除会冲突的原版 `@dougen/dsh-deepseek-usage`；
- 可重复运行（等于就地升级）。

> 如果双击被执行策略拦住：右键 `install.bat` → **以管理员身份运行**，或在 PowerShell 里执行
> `powershell -ExecutionPolicy Bypass -File .\install.ps1`

### 脚本下载失败怎么办

有些网络环境（公司代理 / 系统 TLS 配置）下 PowerShell 下载会被拒。这时：

1. 手动下载 `dsh-deepseek-usage-qwen-0.16.0-qwen.4.tgz`；
2. PowerShell 里执行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -TgzPath .\dsh-deepseek-usage-qwen-0.16.0-qwen.4.tgz
   ```

## 手动安装（三步）

1. **把文件放进插件目录**：解压 tgz，把里面的 `package/` 内容放到
   `C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-deepseek-usage-qwen\`
   （该目录下应有 `package.json`、`lib/`）；
2. **让 DSH 加载它**：编辑 `C:\Users\<你>\.dsh\profiles\desktop\package.json`，
   在 `dsh.profile.bundles` 数组里**去掉** `@dougen/dsh-deepseek-usage`、**加上** `dsh-deepseek-usage-qwen`；
3. **完全重启 DSH**。

## 配置：填阿里云 AccessKey

> 模型的 Key（`sk-ws-…`）只能调模型，查不到余额——这是阿里云接口设计。要显示代金券余额，必须给一对 AccessKey。

1. 打开 <https://ram.console.aliyun.com/manage/ak>；
2. 建议新建 **RAM 子用户**（勾选「使用永久 AccessKey 访问」），复制 **AccessKey ID / Secret**；
3. 给这个用户授权系统策略 **`AliyunBSSReadOnlyAccess`**，**资源范围选「账号级别」**
   （别选成名字很像的 `AliyunSLBReadOnlyAccess`，那是负载均衡）；
4. DSH → 设置 → 插件 → `dsh-deepseek-usage-qwen` → 详情页底部
   「阿里云 AccessKey（查代金券余额）」→ 填 ID 和 Secret → 保存。

保存后会立刻自检：成功显示 `已保存 · ¥金额`，失败会写清原因（ID 不存在 / Secret 不对 / 缺只读权限）。

密钥只存在本机 `~/.dsh/.credentials.yaml`，不会发往浏览器或任何第三方；插件只请求阿里云官方域名 `business.aliyuncs.com`。

## 卸载

```powershell
# 1) 从 profile 的 package.json 的 dsh.profile.bundles 里删掉 dsh-deepseek-usage-qwen
# 2) 删目录
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-deepseek-usage-qwen" -Recurse
# 3) 重启 DSH；想恢复原版就把 @dougen/dsh-deepseek-usage 加回 bundles
```

`install.ps1` 每次运行都会把 `package.json` 备份成 `package.json.bak-<时间戳>`，改坏了可以从那里恢复。