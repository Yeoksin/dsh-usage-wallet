# 常见问题（尤其是插件装了不显示卡片）

## 症状：插件详情页里显示的是「@dougen/dsh-deepseek-usage」、状态「未运行」

说明装的是 **v0.16.0-qwen.1 / qwen.2**：这两个版本的 `cordis.patch.yml` 沿用了上游写法，
把组件名写成了 `@dougen/dsh-deepseek-usage`（等于"顶着原版的名字"加载），DSH 会把它当成
原版插件的别名，于是**不会作为独立插件运行**，侧边栏也就不出现卡片。

**v0.16.0-qwen.3 已修复**：组件名改成本包自己的 `dsh-deepseek-usage-qwen`。

修复步骤：

```powershell
# 1) 重新下载最新的 install.ps1 和 tgz（Releases 页 latest）
powershell -ExecutionPolicy Bypass -File .\install.ps1
# 2) 完全退出 DSH（托盘也退）再打开
```

重启后应看到：详情页标题 `dsh-deepseek-usage-qwen`、版本 `0.16.0-qwen.3`,
「包含的组件」里是 `dsh-deepseek-usage-qwen`（而不是 @dougen/...），状态「运行中」。

## 症状：插件装好了、也运行中，但侧边栏没有卡片

按顺序检查：

1. **有没有完全重启 DSH**（托盘图标也要退出）——宿主代码在启动时加载；
2. **当前模型是谁**：卡片显示的是"当前模型提供商"的余额。如果你选的不是 `qwen-token-plan`，
   看到的就是那个提供商的读数（甚至提示未配置）；
3. **填了阿里云 AccessKey 没有**：插件详情页底部「阿里云 AccessKey（查代金券余额）」→
   填 AccessKey ID / Secret → 保存。保存后会立刻自检：成功显示 `已保存 · ¥金额`；
4. **磁盘上的配置到底是不是对的**（最可靠的第一步排查）：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Raw | ConvertFrom-Json |
  Select-Object -ExpandProperty dsh | Select-Object -ExpandProperty profile |
  Select-Object -ExpandProperty bundles
```

应该能看到 `dsh-deepseek-usage-qwen`，并且**没有** `@dougen/dsh-deepseek-usage`。

## 症状：DSH 打不开，报 `Unexpected token '\uFEFF' ... is not valid JSON`

这是 **qwen.1 / qwen.2 安装脚本的 bug**（Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
会写入 BOM，Node 的 JSON.parse 不认）。数据不会丢。

```powershell
powershell -ExecutionPolicy Bypass -File .\fix-bom.ps1
```

然后重新打开 DSH。也可以先点崩溃窗口里的
「Disable third-party plugins, back up profile patch, and restart」把 DSH 拉起来。

## 症状：保存 AccessKey 时提示「阿里云 AccessKey 无效，或没有费用与成本只读权限」

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| AccessKey ID 不存在（可能已删除或禁用） | ID 复制错了 / 已删除 / 属于别的账号 | 去 RAM 控制台重新复制 |
| AccessKey Secret 不正确（签名未通过） | Secret 复制错、带了空格或丢了尾部字符 | 重新复制（Secret 只显示一次，丢了就新建一对） |
| 缺少费用与成本只读权限 | RAM 用户没授权，或授权范围选成了「资源组级别」 | 用户 → 权限管理 → 新增授权 → **账号级别** → `AliyunBSSReadOnlyAccess` |

注意别选成名字很像的 `AliyunSLBReadOnlyAccess`（那是负载均衡）。

## 症状：余额显示 ¥0.00

AccessKey 与权限都正常，只是这个账号当前没有可用代金券（券过期/用完），
回落查到的账户可用额度也是 0。可以到阿里云「费用与成本 → 卡券」核对。

## 卸载 / 回退到原版

```powershell
# 从 bundles 里移除 dsh-deepseek-usage-qwen，删目录，重启 DSH
Remove-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-deepseek-usage-qwen" -Recurse
# 想用回原版：把 @dougen/dsh-deepseek-usage 重新加进 bundles，并 npm install 原版
```

`install.ps1` 每次改配置前都会把 `package.json` 备份成 `package.json.bak-<时间戳>`，
`fix-bom.ps1` 备份成 `package.json.bomfix-<时间戳>`。