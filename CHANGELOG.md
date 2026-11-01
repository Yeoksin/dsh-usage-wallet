# 更新日志

版本号按发布时间顺序重新编号过（早期用的是上游的 `0.16.x-qwen.x` 形式）。下表是「现在的版本号 ↔ 当时用的版本号」以及每个版本做了什么。

| 版本 | 当时的号 | 主要变化 |
| --- | --- | --- |
| **1.0.0** | 0.16.0-qwen.1 | 分支首个版本：`qwen-token-plan` 显示阿里云代金券余额（BSS OpenAPI + AK/SK）。安装脚本有 BOM bug，DSH 会启动失败。 |
| **1.0.1** | 0.16.0-qwen.2 | 修 BOM：改为字节级 UTF-8 无 BOM 写入 + 落盘自检 + 失败回滚；新增 `fix-bom.ps1`。修 StrictMode 下空 `dependencies` 崩溃。 |
| **1.0.2** | 0.16.0-qwen.3 | 组件注册名改成本包自己的名字，修「插件未运行 / 侧边栏没有卡片」。 |
| **1.0.3** | 0.16.0-qwen.4 | 浏览器端 bundle `id` 与详情页包名判断同步，修「详情页不显示 AccessKey 卡片」；新增离线安装 `install-offline.bat` 与 `-Offline`。 |
| **1.0.4** | 0.16.0-qwen.5 | 新增小米 MiMo 余额（控制台 Cookie 读 `balance` 与 Token Plan 用量）。 |
| **1.0.5** | 0.16.0-qwen.6 | MiMo 单卡去重（provider 别名）、保存反馈改为卡内显示、误填 API Key 时给出提示。 |
| **1.0.6** | 0.16.0-qwen.7 | MiMo 增加 API Key 校验通道（`/v1/models`，`sk-` 与 `tp-`/`ttp-` 分集群）。 |
| **1.0.7** | 0.17.0 | 改名 **`dsh-usage-wallet`**（通用余额/用量插件），安装脚本自动迁移旧名条目。 |
| **1.0.8** | 0.17.1 | 改名收尾：路由 `/api/usage-wallet*`、patch id、日志与 console 前缀、DOM 标识、截图文件名、文档。 |
| **1.0.9** | 0.17.2 | `fix-bom.ps1` 也识别旧包名。 |
| **1.0.10** | 0.17.3 | `install.ps1` 的说明文案改为「通用余额/用量侧边栏」。 |
| **1.0.13** | 1.0.12 | 修关键 bug：Cookie 值含空格（标准写法 ）被误判为「不可用」，导致 MiMo Cookie 存了也显示未配置；同时 list 模式也按 Cookie 规则判定。 |
| **1.0.12** | 1.0.11 | 修显示误导：只填了 API Key（没填 Cookie）时，状态页不再显示「未配置密钥」，改为「已填 Key · 缺 Cookie」；卡片角标改为「已填 Key」。 |
| **1.0.11** | 1.0.0 | 版本号与上游脱钩；旧的 `0.16.x` / `0.17.x` Release 与 tag 全部删除，只保留本版本；文档历史统一重排。 |

> 更早的上游项目是 [`dougen/dsh-deepseek-usage`](https://github.com/dougen/dsh-deepseek-usage)（MIT），本仓库是它的非官方分支。
