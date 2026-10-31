/**
 * dsh-usage-wallet —— 小米 MiMo（platform.xiaomimimo.com）账户余额。
 *
 * MiMo 开放平台的余额**没有** API Key 接口：推理 Key（`sk-…` 按量 / `tp-…` Token Plan）
 * 只能调模型，账户余额与套餐用量在控制台自己的 JSON API 后面，需要浏览器登录态里的
 * Cookie（`api-platform_serviceToken` + `userId`）。这个模块按 CodexBar 已验证的口径实现：
 *
 *   GET https://platform.xiaomimimo.com/api/v1/balance
 *        → { code: 0, data: { balance, currency, cashBalance, giftBalance } }
 *   GET https://platform.xiaomimimo.com/api/v1/tokenPlan/detail   （可选）
 *        → { code: 0, data: { planCode, currentPeriodEnd, expired } }
 *   GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage    （可选）
 *        → { code: 0, data: { monthUsage: { percent, items: [{ name, used, limit, percent }] } } }
 *
 * 设计约束与 accounts.js 一致：解析函数单独导出、不联网也能测；拿不到数字就报分类码，
 * 绝不把缺失当 0。Cookie 属于机密，任何响应/日志都不回传它的值。
 */

const ACCOUNT_EMPTY = 'empty';
const ACCOUNT_SHAPE = 'shape';

/** MiMo 控制台 API 根（可用 MIMO_API_URL 覆盖，便于测试与代理）。 */
export const MIMO_API_BASE = 'https://platform.xiaomimimo.com/api/v1';

/** 取一次数据必须带的两个 cookie；其余（api-platform_ph / api-platform_slh）有则带上。 */
const REQUIRED_COOKIES = ['api-platform_serviceToken', 'userId'];
const KNOWN_COOKIES = new Set([...REQUIRED_COOKIES, 'api-platform_ph', 'api-platform_slh']);

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

function fail(code) {
  return { ok: false, balance: null, usage: null, code };
}

/** 解析 `yyyy-MM-dd HH:mm:ss`（北京时间，无时区后缀）或 ISO 字符串 → epoch ms。 */
function toEpochMs(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (local !== null) {
    const [, y, mo, d, h, mi, s] = local;
    // MiMo 的控制台时间按北京时间（UTC+8）给出。
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi), Number(s));
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 把用户粘贴的 Cookie 头整理成只含已知 cookie 的标准头。
 *
 * 接受完整 `Cookie:` 头（`a=1; b=2`）、每行一个、或多行粘贴（浏览器复制出来的
 * 常常是「name<TAB>value」两列）。缺必需项时返回 null——调用方据此报「需要重新登录」。
 *
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeMiMoCookie(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const pairs = new Map();
  // 先按行、再按分号切：既支持 "a=1; b=2"，也支持浏览器复制出的「name<TAB>value」多行。
  const lines = raw.split(new RegExp('[' + "\r" + "\n" + ']+'));
  for (const line of lines) {
    for (const part of line.split(';')) {
      const trimmed = part.trim();
      if (trimmed === '') continue;
      let name;
      let value;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        name = trimmed.slice(0, eq).trim();
        value = trimmed.slice(eq + 1).trim();
      } else {
        const sep = trimmed.search(new RegExp('[' + "\t" + ' ]+'));
        if (sep <= 0) continue;
        name = trimmed.slice(0, sep).trim();
        value = trimmed.slice(sep).trim();
      }
      // 去掉可能的引号包裹
      if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' || first === "'") && first === last) value = value.slice(1, -1).trim();
      }
      if (KNOWN_COOKIES.has(name) && value !== '') pairs.set(name, value);
    }
  }
  if (!REQUIRED_COOKIES.every((name) => pairs.has(name))) return null;
  return [...pairs].map(([name, value]) => name + '=' + value).join('; ');
}

export function isMiMoCookieShapeValid(raw) {
  return normalizeMiMoCookie(raw) !== null;
}

/**
 * 解析 `GET /api/v1/balance`：
 * { code: 0, message, data: { balance, currency, cashBalance, giftBalance } }
 *
 * code 非 0 时按业务错误处理；401/403 视为登录态失效（unauthorized）。
 */
export function parseMiMoBalance(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(ACCOUNT_SHAPE);
  const code = toFinite(body.code);
  if (Number.isFinite(code) && code !== 0) {
    if (code === 401 || code === 403) return fail('unauthorized');
    return fail(ACCOUNT_SHAPE);
  }
  const data = body.data;
  if (data === null || typeof data !== 'object') return fail(ACCOUNT_SHAPE);
  const total = finiteOrNull(data.balance);
  if (total === null) return fail(ACCOUNT_EMPTY);
  const currency = typeof data.currency === 'string' && data.currency.trim() !== '' ? data.currency.trim().toUpperCase() : 'CNY';
  return {
    ok: true,
    balance: { isAvailable: true, total: Math.round(total * 100) / 100, currency },
    usage: null,
    detail: {
      cash: finiteOrNull(data.cashBalance),
      gift: finiteOrNull(data.giftBalance),
    },
  };
}

/**
 * 解析 `GET /api/v1/tokenPlan/usage`（可选）：月度套餐用了多少。
 * { code: 0, data: { monthUsage: { percent, items: [...] } } }
 *
 * @returns {{ percent:number, used:number|null, limit:number|null, resetsAt:number|null }|null}
 */
export function parseMiMoTokenPlanUsage(body) {
  if (body === null || typeof body !== 'object') return null;
  const code = toFinite(body.code);
  if (Number.isFinite(code) && code !== 0) return null;
  const month = body.data && typeof body.data === 'object' ? body.data.monthUsage : null;
  if (month === null || typeof month !== 'object') return null;
  const percent = finiteOrNull(month.percent);
  if (percent === null) return null;
  let used = 0;
  let limit = 0;
  for (const item of Array.isArray(month.items) ? month.items : []) {
    const u = finiteOrNull(item?.used);
    const l = finiteOrNull(item?.limit);
    if (u !== null) used += u;
    if (l !== null) limit += l;
  }
  return {
    percent: Math.max(0, Math.min(100, percent * (percent <= 1 ? 100 : 1))),
    used: limit > 0 ? used : null,
    limit: limit > 0 ? limit : null,
    resetsAt: null,
  };
}

/**
 * 解析 `GET /api/v1/tokenPlan/detail`（可选）：套餐周期结束时间。
 * { code: 0, data: { planCode, currentPeriodEnd, expired } }
 */
export function parseMiMoTokenPlanDetail(body) {
  if (body === null || typeof body !== 'object') return null;
  const code = toFinite(body.code);
  if (Number.isFinite(code) && code !== 0) return null;
  const data = body.data;
  if (data === null || typeof data !== 'object') return null;
  return {
    planCode: typeof data.planCode === 'string' ? data.planCode : null,
    periodEnd: toEpochMs(data.currentPeriodEnd),
    expired: data.expired === true,
  };
}

/**
 * 一次完整读取：balance（必须）+ tokenPlan detail / usage（可选）。
 *
 * 套餐用量存在时，把它放进 `usage.windows` 一条 `cycle` 窗口——卡片的
 * 「最紧窗口」逻辑会自动把它显示成百分比，同时余额仍以 balance 返回。
 *
 * @param {object} options
 * @param {string} options.cookie         normalizeMiMoCookie 的结果
 * @param {string} [options.apiBase]
 * @param {Function} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export async function readMiMoAccount({ cookie, apiBase = MIMO_API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = String(apiBase).replace(/\/+$/, '');

  async function getJson(path) {
    const response = await fetchImpl(base + path, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        cookie,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        origin: 'https://platform.xiaomimimo.com',
        referer: 'https://platform.xiaomimimo.com/#/console/balance',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    // 登录态过期时控制台会把请求 302 到小米账号登录页。
    if (response.status >= 300 && response.status < 400) return { status: response.status, body: null, redirected: true };
    let body = null;
    try {
      const text = await response.text();
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, redirected: false };
  }

  let main;
  try {
    main = await getJson('/balance');
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
  if (main.redirected || main.status === 401) return fail('unauthorized');
  if (main.status === 403) return fail('unauthorized');
  if (main.status < 200 || main.status >= 300) return fail(ACCOUNT_SHAPE);
  const parsed = parseMiMoBalance(main.body);
  if (!parsed.ok) return parsed;

  // 可选：套餐详情与用量，任一失败都不影响余额。
  try {
    const detail = parseMiMoTokenPlanDetail((await getJson('/tokenPlan/detail')).body);
    const plan = parseMiMoTokenPlanUsage((await getJson('/tokenPlan/usage')).body);
    if (plan !== null) {
      parsed.usage = {
        plan: detail?.planCode ?? null,
        windows: [{ key: 'cycle', percent: plan.percent, resetsAt: detail && !detail.expired ? detail.periodEnd : null }],
      };
    }
  } catch { /* 套餐信息是可选的 */ }

  return parsed;
}

// ---- API Key（sk- 按量 / tp- Token Plan）---------------------------------

/**
 * MiMo 的推理网关。Key 类型决定走哪一个：
 *   sk-  按量计费 → api.xiaomimimo.com
 *   tp-  Token Plan（个人）→ token-plan-{cn,sgp,ams}
 *   ttp- Token Plan（团队）→ 同上
 *
 * 注意：这些网关**没有任何账户/计费接口**（实测所有 /v1/usage、/v1/balance 之类路径
 * 都是 404；官方文档也只把余额与套餐用量放在控制台）。所以 Key 只能用于"验证 Key 有效
 * 与可用模型"，余额必须走控制台 Cookie（readMiMoAccount）。
 */
export const MIMO_API_HOSTS = {
  payg: 'https://api.xiaomimimo.com',
  tp: [
    'https://token-plan-cn.xiaomimimo.com',
    'https://token-plan-sgp.xiaomimimo.com',
    'https://token-plan-ams.xiaomimimo.com',
  ],
};

/** 从 Key 前缀判断类型：'sk'（按量）、'tp'（个人套餐）、'ttp'（团队套餐）、'unknown'。 */
export function miMoKeyKind(key) {
  if (typeof key !== 'string') return 'unknown';
  const value = key.trim();
  if (value.startsWith('ttp-')) return 'ttp';
  if (value.startsWith('tp-')) return 'tp';
  if (value.startsWith('sk-')) return 'sk';
  return 'unknown';
}

/**
 * 校验一对 MiMo API Key：用 `GET /v1/models` 试探。
 *
 * 返回 `{ ok: true, kind, host, models: string[], count }`，或
 * `{ ok: false, code: 'badKey' | 'unauthorized' | 'network' | 'timeout' }`。
 * Key 本身绝不回传（只给类型和模型名）。
 */
export async function validateMiMoApiKey({ key, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const value = typeof key === 'string' ? key.trim() : '';
  const kind = miMoKeyKind(value);
  if (value === '' || kind === 'unknown') return { ok: false, code: 'badKey' };

  const hosts = kind === 'sk' ? [MIMO_API_HOSTS.payg] : [...MIMO_API_HOSTS.tp];
  let lastError = 'network';
  for (const host of hosts) {
    let response;
    try {
      response = await fetchImpl(host + '/v1/models', {
        method: 'GET',
        headers: { authorization: 'Bearer ' + value, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      lastError = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
      continue;
    }
    // 401/403：Key 不对（或不属于这个集群）。tp- 有三集群，逐个试。
    if (response.status === 401 || response.status === 403) {
      lastError = 'unauthorized';
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      lastError = 'network';
      continue;
    }
    let body = null;
    try { body = JSON.parse(await response.text()); } catch { body = null; }
    const models = [];
    for (const item of Array.isArray(body?.data) ? body.data : []) {
      const id = typeof item?.id === 'string' ? item.id : (typeof item === 'string' ? item : null);
      if (id !== null) models.push(id);
    }
    return { ok: true, kind, host: host.replace(/^https:\/\//, ''), models, count: models.length };
  }
  return { ok: false, code: lastError };
}
