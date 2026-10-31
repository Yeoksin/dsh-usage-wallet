# NOTICE / 来源说明

本仓库是 [`dougen/dsh-deepseek-usage`](https://github.com/dougen/dsh-deepseek-usage) 的
**非官方分支（fork）**，基线版本 `v0.16.0`（MIT 许可，版权归原作者 dougen）。

## 名称

本分支 v1.0.7 起叫 **`dsh-usage-wallet`**（原名 `dsh-deepseek-usage-qwen`）：它不只服务 qwen-token-plan，而是通用的「当前模型余额 / 用量」侧边栏卡片。仓库 <https://github.com/Yeoksin/dsh-usage-wallet>。

版本号采用独立编号（`1.0.0` 起、按发布顺序递增到当前 `1.0.11`），不再沿用上游 `0.16.x` 的版本。历史版本号与旧仓库名的对应关系见 [CHANGELOG.md](./CHANGELOG.md)。

## 本分支相对上游的改动

所有改动都集中在三个地方，`lib/pricing.js` 及其余文件与上游 `v0.16.0` 逐字节一致：

| 文件 | 改动 |
| --- | --- |
| `lib/aliyun.js` | **新增**。阿里云「费用与成本」BSS OpenAPI 的 RPC 签名（HMAC-SHA1）与两个接口的解析：`QueryCashCoupons`（累加 `Status=Available` 的代金券余额）、`QueryAccountBalance`（无券时回落账户可用额度）。 |
| `lib/accounts.js` | 能力表新增 `qwen-token-plan`（`kind: balance`，`secrets: 'aliyun-aksk'`），新增导出 `providerSecretsOf()`（两段凭据 AK/SK 的描述）。 |
| `lib/index.js` | 阿里云 AK/SK 两段凭据的解析与缓存；`POST /token` 支持写入/清除 `accessKeyId` / `accessKeySecret`；失败原因按上游 Code 细分（Key 不存在 / Secret 不对 / 缺只读权限）；状态页行带已保存 AK 的掩码。**另外修了上游的一个 bug**：路由读请求体时用了 `fetch Response` 的写法（`headers.get()` / `text()`），而 DSH 的 webServer 交给路由的是 `node:http` 的 `IncomingMessage`，导致真实 HTTP 的 `POST /token` 一律返回 413「请求内容无法解析」——插件页保存令牌/AK 必然失败。新加的 `readRequestBody()` 同时兼容 `IncomingMessage` 与 `Request` 两种形态。 |
| `lib/mimo.js` | **新增**。小米 MiMo 控制台余额：`platform.xiaomimimo.com/api/v1/balance`（+ 可选 `tokenPlan/detail`、`tokenPlan/usage`）需要登录 Cookie；另提供 API Key 校验（`GET /v1/models`，`sk-` 走按量网关、`tp-`/`ttp-` 依次试 cn/sgp/ams 集群）。MiMo 没有任何 Key 认证的余额接口。 |
| `lib/client.js` | 插件详情页新增「阿里云 AccessKey（查代金券余额）」填写卡；保存后展示宿主自检结果（成功显示金额，失败显示具体原因）；状态页显示已保存 AK 的掩码。 |
| `README.md` | 新增「Qwen Token Plan / 阿里云代金券」章节与安装说明。 |
| `test/*.test.mjs` | 在保留上游全部测试的基础上，新增 `aliyun.test.mjs`（签名用阿里云官方文档向量验证、解析与失败分类）、`plugin-host.test.mjs`（真起 `node:http` 服务器跑通保存→读取→状态页链路）、`qwen-accounts.test.mjs`（能力表）。 |
| `scripts/sync-upstream.mjs` | 从上游新版本同步基线并重放补丁的说明脚本。 |

上游原有的 README（英文/中文完整说明）保留为 [`README.upstream.md`](./README.upstream.md)。

## 许可

MIT，见 [LICENSE](./LICENSE)。原插件版权归 dougen，本分支改动同样以 MIT 发布。

## 商标

「DeepSeek Harness」「阿里云 / Alibaba Cloud」「百炼 / Bailian」「Qwen / 千问」分属各自权利人。
本项目仅调用其公开 API，与这些公司无隶属关系。