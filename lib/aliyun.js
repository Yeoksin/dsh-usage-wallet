/**
 * dsh-deepseek-usage —— 阿里云「费用与成本」余额读取（本地补丁，非上游代码）。
 *
 * 背景：qwen-token-plan 路由的推理 Key（`sk-ws-…` / `sk-sp-…`）只能调模型，查不到
 * 任何账户数据；阿里云送的用户代金券余额在「费用与成本」的 BSS OpenAPI 后面，只有
 * 账号（或 RAM 子账号）的 AccessKey ID / Secret 才签得动。所以这个文件提供：
 *
 *   · `signRpcRequest`            —— BSS 的 RPC 签名（HMAC-SHA1，v1.0 口径）；
 *   · `parseAliyunCashCoupons`    —— `QueryCashCoupons` → 可用代金券余额合计；
 *   · `parseAliyunAccountBalance` —— `QueryAccountBalance` → 账户可用额度；
 *   · `makeAliyunReader`          —— 一次完整读取：没有代金券时回落到账户额度。
 *
 * 设计约束与 accounts.js 一致：解析函数单独导出供测试，拿不到数字就报分类码，
 * 绝不把缺失当 0（Number(null) === 0 会把「读不到」显示成「余额 0」）。
 * 上游响应原文一律不往界面上透传：阿里云的报错里可能带 AccessKeyId 片段。
 */

import { createHmac, randomUUID } from 'node:crypto';

/** 失败分类（与 accounts.js 的 ACCOUNT_* 同值，宿主按同一套文案表映射）。 */
const ACCOUNT_EMPTY = 'empty';
const ACCOUNT_SHAPE = 'shape';
const ACCOUNT_UNAVAILABLE = 'unavailable';

/** BSS OpenAPI 的 RPC 端点与版本（2026-10 官方文档：business.aliyuncs.com）。 */
const BSS_HOST = 'https://business.aliyuncs.com';
const BSS_VERSION = '2017-12-14';

/** 响应体上限：余额接口正常只有几百字节，64KiB 足够。 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * RFC 3986 编码（阿里云签名口径）：encodeURIComponent 已经放过 `! ' ( ) *`，
 * 这几个必须再编码；`~` 是唯一不需要编码的标点。
 */
function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%7E/gi, '~');
}

/** ISO 8601 UTC，秒级（`2026-10-31T08:00:00Z`）。 */
function isoTimestamp(now) {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 构造一次 BSS RPC GET 请求的完整 URL（含 Signature）。
 *
 * @param {object} options
 * @param {string} options.accessKeyId
 * @param {string} options.accessKeySecret
 * @param {string} options.action        例如 QueryCashCoupons / QueryAccountBalance
 * @param {object} [options.params]      业务参数（本补丁只用到空参数）
 * @param {Date}   [options.now]         便于单测注入确定时间
 * @param {string} [options.nonce]       便于单测注入确定 nonce
 * @returns {string}
 */
export function signRpcRequest({ accessKeyId, accessKeySecret, action, params = {}, now = new Date(), nonce = randomUUID() }) {
  const query = {
    Format: 'JSON',
    Version: BSS_VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
    Timestamp: isoTimestamp(now),
    Action: action,
    ...params,
  };
  // 按参数名字典序拼 CanonicalizedQueryString；名与值都要编码。
  const canonical = Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key])}`)
    .join('&');
  // RPC 签名 v1.0：StringToSign = METHOD & percentEncode("/") & percentEncode(canonical)
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = createHmac('sha1', `${accessKeySecret}&`).update(stringToSign, 'utf8').digest('base64');
  return `${BSS_HOST}/?${canonical}&Signature=${percentEncode(signature)}`;
}

/** 容忍字符串/数字，返回有限数或 NaN（与 accounts.js 同一口径）。 */
function toFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 取有限数或 null。 */
function finiteOrNull(value) {
  const n = toFinite(value);
  return Number.isFinite(n) ? n : null;
}

function fail(code, detail = null) {
  return { ok: false, balance: null, usage: null, code, detail };
}

/**
 * 上游错误码白名单：只保留形状像 `InvalidAccessKeyId.NotFound` 的 Code。
 * 上游 Message 一律不进 detail——里面可能带 AccessKeyId 片段或账号信息。
 */
function safeDetail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9.]{0,80}$/.test(trimmed) ? trimmed : null;
}

function okBalance(total, currency = 'CNY') {
  return { ok: true, balance: { isAvailable: true, total, currency }, usage: null };
}

/** 业务错误码里哪些属于「凭据无效 / 没权限」——决定界面提示去改 AccessKey。 */
const AUTH_CODES = /InvalidAccessKeyId|SignatureDoesNotMatch|InvalidSecurityToken|NoPermission|NotAuthorized|Forbidden|AuthSiteFail/i;

/**
 * 上游 HTTP 失败或业务失败 → 归一分类。
 * 只读 Code/HTTP 状态，绝不把 Message 原文带出去（可能含 AccessKeyId 片段）。
 */
function classifyBssFailure(status, body) {
  const upstream = safeDetail(body && typeof body.Code === 'string' ? body.Code : '');
  if (status === 401 || status === 403) return { code: 'unauthorized', detail: upstream ?? `HTTP ${status}` };
  const code = upstream ?? '';
  if (AUTH_CODES.test(code)) return { code: 'unauthorized', detail: upstream };
  if (body && body.Success === false) return { code: ACCOUNT_UNAVAILABLE, detail: upstream };
  return { code: ACCOUNT_SHAPE, detail: upstream };
}

/**
 * 2xx 响应里也可能带业务错误（BSS 的鉴权失败常常是 HTTP 200 + Code: NoPermission）。
 * 成功口径：Success !== false 且 Code 是 `200` / `Success`（两个接口各自的口径）。
 *
 * @returns {{code:string, detail:string|null}|null} 失败分类；成功返回 null。
 */
function businessFailure(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const code = typeof body.Code === 'string' ? body.Code.trim() : '';
  if (body.Success === true) return null;
  if (body.Success === false) return classifyBssFailure(200, body);
  if (code !== '' && !/^(200|success)$/i.test(code)) return classifyBssFailure(200, body);
  return null;
}

/**
 * 解析 `QueryCashCoupons` 的响应：
 * { Success, Code, Data: { CashCoupon: [ { Status, Balance, NominalValue, ExpiryTime, … } ] } }
 *
 * 只累加 `Status === 'Available'` 的代金券余额；没有 CashCoupon 字段（账号从没有
 * 代金券）与空数组都算「没有代金券」，由调用方决定回落账户额度。
 *
 * @returns {{ ok: true, balance, usage: null, count: number } | { ok: false, balance: null, usage: null, code, count: number }}
 */
export function parseAliyunCashCoupons(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ...fail(ACCOUNT_SHAPE), count: 0 };
  const business = businessFailure(body);
  if (business !== null) return { ...fail(business.code, business.detail), count: 0 };
  const data = body.Data;
  if (data === null || typeof data !== 'object') return { ...fail(ACCOUNT_SHAPE), count: 0 };
  const coupons = data.CashCoupon;
  // 从没有代金券时接口不返回 CashCoupon 字段，这是「空」而不是「形状不对」。
  if (coupons === undefined || coupons === null) return { ...fail(ACCOUNT_EMPTY), count: 0 };
  if (!Array.isArray(coupons)) return { ...fail(ACCOUNT_SHAPE), count: 0 };
  let total = 0;
  let count = 0;
  for (const coupon of coupons) {
    if (coupon === null || typeof coupon !== 'object') continue;
    const status = typeof coupon.Status === 'string' && coupon.Status !== '' ? coupon.Status : 'Available';
    if (status !== 'Available') continue;
    const balance = finiteOrNull(coupon.Balance);
    if (balance === null) continue;
    total += balance;
    count += 1;
  }
  return { ...okBalance(Math.round(total * 100) / 100, 'CNY'), count };
}

/**
 * 解析 `QueryAccountBalance` 的响应：
 * { Success, Code, Data: { AvailableAmount, AvailableCashAmount, CreditAmount, Currency } }
 *
 * `AvailableAmount` 是「可用额度」（现金 + 信控），代金券不在这项里；作为没有
 * 代金券时的回落读数。
 */
export function parseAliyunAccountBalance(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(ACCOUNT_SHAPE);
  const business = businessFailure(body);
  if (business !== null) return fail(business.code, business.detail);
  const data = body.Data;
  if (data === null || typeof data !== 'object') return fail(ACCOUNT_SHAPE);
  const total = finiteOrNull(data.AvailableAmount);
  if (total === null) return fail(ACCOUNT_EMPTY);
  const currency = typeof data.Currency === 'string' && data.Currency.trim() !== '' ? data.Currency.trim() : 'CNY';
  return okBalance(Math.round(total * 100) / 100, currency);
}

/**
 * 一次完整的阿里云余额读取。
 *
 * 顺序：先用 AccessKey 查代金券（`QueryCashCoupons`）；账号有可用代金券就报代金券
 * 余额（用户口中的「代金券余额」）；一张都没有才回落 `QueryAccountBalance` 的
 * 账户可用额度——这样卡片要么显示券的余额，要么显示账户还能花的钱，不会因为
 * 「没有券」而空白。
 *
 * @param {object} options
 * @param {string} options.accessKeyId
 * @param {string} options.accessKeySecret
 * @param {Function} [options.fetchImpl]  便于测试注入
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok:boolean, balance:object|null, usage:null, code?:string, source?:string}>}
 */
export async function readAliyunBalance({
  accessKeyId,
  accessKeySecret,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
} = {}) {
  /** 发一次已签名的 GET，返回 { status, body }；网络/超时错误抛出带 name 的 Error。 */
  async function call(action) {
    const url = signRpcRequest({ accessKeyId, accessKeySecret, action });
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('payload-too-large');
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  const attempt = async (action, parse) => {
    try {
      const res = await call(action);
      if (!(res.status >= 200 && res.status < 300)) {
        const failure = classifyBssFailure(res.status, res.body);
        return fail(failure.code, failure.detail);
      }
      if (res.body === null) return fail(ACCOUNT_SHAPE);
      return parse(res.body);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      return fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
    }
  };

  // 1) 代金券：有可用券就报券的余额（哪怕已经花到 0，这也是「券的余额」）。
  const coupons = await attempt('QueryCashCoupons', parseAliyunCashCoupons);
  if (coupons.ok && coupons.count > 0) return { ...coupons, source: 'voucher' };
  // 凭据无效时不必再问第二个接口，直接上报让用户去改 AccessKey。
  if (!coupons.ok && coupons.code === 'unauthorized') return coupons;
  if (!coupons.ok && coupons.code === 'network') return coupons;
  if (!coupons.ok && coupons.code === 'timeout') return coupons;

  // 2) 没有代金券（或券接口形状异常）→ 账户可用额度兜底。
  const account = await attempt('QueryAccountBalance', parseAliyunAccountBalance);
  if (account.ok) return { ...account, source: 'account' };
  // 券接口能读到、只是没有券：退回「券余额 0」比报错更贴近事实。
  if (coupons.ok) return { ...coupons, source: 'voucher' };
  return account;
}

/** 供 index.js 判断是否是多凭据（AK/SK）提供商时复用（避免两处各写一份常量）。 */
export const ALIYUN_CREDENTIAL_KIND = 'aliyun-aksk';