// 小米 MiMo 余额能力的测试：Cookie 整理、余额解析、套餐用量、取数（含登录过期）、宿主集成。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMiMoCookie,
  isMiMoCookieShapeValid,
  parseMiMoBalance,
  parseMiMoTokenPlanDetail,
  parseMiMoTokenPlanUsage,
  readMiMoAccount,
} from '../lib/mimo.js';
import { accountCapabilityOf, providerCookieOf, candidateRefsOf, canonicalProviderId, supportedProviderIds } from '../lib/accounts.js';

const VALID = 'api-platform_serviceToken=eyJhbGciOi.abc; userId=2451887661; api-platform_ph=xyz';

test('normalizeMiMoCookie：只保留已知 cookie，顺序与必需项正确', () => {
  const out = normalizeMiMoCookie(VALID);
  assert.ok(out);
  assert.match(out, /api-platform_serviceToken=eyJhbGciOi\.abc/);
  assert.match(out, /userId=2451887661/);
  assert.match(out, /api-platform_ph=xyz/);
  // 未知 cookie 丢弃（不上游转发无关内容）
  assert.equal(normalizeMiMoCookie('foo=1; ' + VALID).includes('foo=1'), false);
});

test('normalizeMiMoCookie：支持浏览器复制出的多行/Tab 形式', () => {
  const raw = [
    'api-platform_serviceToken\teyJhbGciOi.def',
    'userId\t2451887661',
    'api-platform_slh\tqq',
  ].join('\n');
  const out = normalizeMiMoCookie(raw);
  assert.ok(out);
  assert.match(out, /api-platform_serviceToken=eyJhbGciOi\.def/);
  assert.match(out, /api-platform_slh=qq/);
});

test('normalizeMiMoCookie：缺 userId / 空串 → null（说明需要重新登录）', () => {
  assert.equal(normalizeMiMoCookie('api-platform_serviceToken=abc'), null);
  assert.equal(normalizeMiMoCookie(''), null);
  assert.equal(normalizeMiMoCookie(undefined), null);
  assert.equal(isMiMoCookieShapeValid('api-platform_serviceToken=abc; userId=1'), true);
  assert.equal(isMiMoCookieShapeValid('sk-something'), false);
});

test('parseMiMoBalance：标准响应 → 金额与币种', () => {
  const parsed = parseMiMoBalance({
    code: 0,
    data: { balance: '42.35', currency: 'CNY', cashBalance: '20.00', giftBalance: '22.35' },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.balance.total, 42.35);
  assert.equal(parsed.balance.currency, 'CNY');
  assert.equal(parsed.detail.cash, 20);
  assert.equal(parsed.detail.gift, 22.35);
});

test('parseMiMoBalance：401/403 → unauthorized；缺 data → shape；余额字段缺失 → empty', () => {
  assert.equal(parseMiMoBalance({ code: 401 }).code, 'unauthorized');
  assert.equal(parseMiMoBalance({ code: 403 }).code, 'unauthorized');
  assert.equal(parseMiMoBalance({ code: 0 }).code, 'shape');
  assert.equal(parseMiMoBalance({ code: 500, data: null }).code, 'shape');
  assert.equal(parseMiMoBalance({ code: 0, data: { currency: 'CNY' } }).code, 'empty');
  assert.equal(parseMiMoBalance(null).code, 'shape');
});

test('parseMiMoTokenPlanUsage：百分比与合计用量；解析失败返回 null', () => {
  const usage = parseMiMoTokenPlanUsage({
    code: 0,
    data: { monthUsage: { percent: 0.35, items: [{ name: 'mimo-v2', used: 350, limit: 1000, percent: 0.35 }] } },
  });
  assert.equal(usage.percent, 35);
  assert.equal(usage.used, 350);
  assert.equal(usage.limit, 1000);
  assert.equal(parseMiMoTokenPlanUsage({ code: 1 }), null);
  assert.equal(parseMiMoTokenPlanUsage({ code: 0, data: {} }), null);
});

test('parseMiMoTokenPlanDetail：北京时间解析与 expired', () => {
  const detail = parseMiMoTokenPlanDetail({ code: 0, data: { planCode: 'mimo-pro', currentPeriodEnd: '2026-11-30 23:59:59', expired: false } });
  assert.equal(detail.planCode, 'mimo-pro');
  assert.equal(detail.expired, false);
  // 北京时间 2026-11-30 23:59:59 == UTC 15:59:59
  assert.equal(new Date(detail.periodEnd).toISOString(), '2026-11-30T15:59:59.000Z');
});

/** 假 fetch：按 path 返回固定响应。 */
function fakeFetch(map, calls = []) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, headers: init?.headers ?? {} });
    const entry = map[path];
    if (entry === undefined) return { status: 404, text: async () => '' };
    if (entry instanceof Error) throw entry;
    return { status: entry.status ?? 200, text: async () => JSON.stringify(entry.body ?? null) };
  };
}

test('readMiMoAccount：余额 + 套餐用量合成（带 Cookie 头）', async () => {
  const calls = [];
  const result = await readMiMoAccount({
    cookie: VALID,
    fetchImpl: fakeFetch({
      '/api/v1/balance': { body: { code: 0, data: { balance: '88.80', currency: 'CNY' } } },
      '/api/v1/tokenPlan/detail': { body: { code: 0, data: { planCode: 'mimo-standard', currentPeriodEnd: '2026-11-30 23:59:59', expired: false } } },
      '/api/v1/tokenPlan/usage': { body: { code: 0, data: { monthUsage: { percent: 0.25, items: [] } } } },
    }, calls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.balance.total, 88.8);
  assert.equal(result.usage.windows[0].percent, 25);
  assert.equal(result.usage.plan, 'mimo-standard');
  assert.ok(calls.every((c) => String(c.headers.cookie).includes('userId=2451887661')));
});

test('readMiMoAccount：302/401 → unauthorized（登录过期）', async () => {
  const redirected = await readMiMoAccount({ cookie: VALID, fetchImpl: fakeFetch({ '/api/v1/balance': { status: 302, body: null } }) });
  assert.equal(redirected.code, 'unauthorized');
  const unauthorized = await readMiMoAccount({ cookie: VALID, fetchImpl: fakeFetch({ '/api/v1/balance': { status: 401, body: {} } }) });
  assert.equal(unauthorized.code, 'unauthorized');
});

test('readMiMoAccount：网络/超时分类', async () => {
  const timeout = new Error('t'); timeout.name = 'TimeoutError';
  assert.equal((await readMiMoAccount({ cookie: VALID, fetchImpl: fakeFetch({ '/api/v1/balance': timeout }) })).code, 'timeout');
  assert.equal((await readMiMoAccount({ cookie: VALID, fetchImpl: fakeFetch({ '/api/v1/balance': new TypeError('fetch failed') }) })).code, 'network');
});

test('readMiMoAccount：套餐接口 404 不影响余额', async () => {
  const result = await readMiMoAccount({
    cookie: VALID,
    fetchImpl: fakeFetch({ '/api/v1/balance': { body: { code: 0, data: { balance: '1.00', currency: 'CNY' } } } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.usage, null);
});

test('能力表：mimo / xiaomimimo 是 Cookie 类余额提供商', () => {
  for (const id of ['mimo', 'xiaomimimo']) {
    const entry = accountCapabilityOf(id);
    assert.ok(entry, `${id} 未登记`);
    assert.equal(entry.kind, 'balance');
    assert.equal(entry.secrets, 'mimo-cookie');
    const spec = providerCookieOf(id);
    assert.deepEqual(spec.refs, ['MIMO_COOKIE']);
    assert.deepEqual(candidateRefsOf(id), ['MIMO_COOKIE']);
  }
  assert.equal(providerCookieOf('qwen-token-plan'), null);
  assert.equal(providerCookieOf('deepseek'), null);
});
test('别名：xiaomi / xiaomimimo 归一到一个能力，且只列一次', () => {
  for (const id of ['xiaomi', 'xiaomimimo', 'xiaomi-mimo']) {
    assert.equal(canonicalProviderId(id), 'mimo', `${id} 应归一到 mimo`);
    const entry = accountCapabilityOf(id);
    assert.ok(entry, `${id} 应能解析到能力`);
    assert.equal(entry.kind, 'balance');
    assert.ok(providerCookieOf(id), `${id} 应能走 Cookie 路径`);
    assert.deepEqual(candidateRefsOf(id), ['MIMO_COOKIE']);
  }
  const ids = supportedProviderIds();
  assert.equal(ids.filter((id) => id === 'mimo').length, 1);
  assert.equal(ids.includes('xiaomimimo'), false, '别名不该单独出现在能力列表里');
});

test('粘贴格式宽容：带 "Cookie:" 前缀或整份请求头都能解析', () => {
  const bare = 'api-platform_serviceToken=abc; userId=123';
  assert.equal(normalizeMiMoCookie('Cookie: ' + bare), bare);
  assert.equal(normalizeMiMoCookie('cookie:  ' + bare), bare);
  const fullHeaders = [
    'host: platform.xiaomimimo.com',
    'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'accept: application/json, text/plain, */*',
    'cookie: ' + bare,
    'referer: https://platform.xiaomimimo.com/#/console/balance',
  ].join('\n');
  assert.equal(normalizeMiMoCookie(fullHeaders), bare, '整份请求头里只挑已知 cookie');
  // 缺必需项仍然拒绝（不能把无关内容当成 Cookie 通过）
  assert.equal(normalizeMiMoCookie('host: platform.xiaomimimo.com\nuser-agent: x'), null);
});

test('没有 Token Plan 时不显示套餐用量（哪怕 usage 接口返回 percent 0）', async () => {
  const result = await readMiMoAccount({
    cookie: VALID,
    fetchImpl: fakeFetch({
      '/api/v1/balance': { body: { code: 0, data: { balance: '2.99', currency: 'CNY' } } },
      // detail 表示"没有套餐"：planCode 缺失
      '/api/v1/tokenPlan/detail': { body: { code: 0, data: { planCode: null, expired: false } } },
      // usage 接口仍然吐了一个 0——不能拿它当"用了 0%"显示
      '/api/v1/tokenPlan/usage': { body: { code: 0, data: { monthUsage: { percent: 0, items: [] } } } },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.balance.total, 2.99);
  assert.equal(result.usage, null, '没有套餐就不要显示 usage 窗口');
});

test('过期的 Token Plan 也不显示用量', async () => {
  const result = await readMiMoAccount({
    cookie: VALID,
    fetchImpl: fakeFetch({
      '/api/v1/balance': { body: { code: 0, data: { balance: '1.00', currency: 'CNY' } } },
      '/api/v1/tokenPlan/detail': { body: { code: 0, data: { planCode: 'mimo-standard', expired: true } } },
      '/api/v1/tokenPlan/usage': { body: { code: 0, data: { monthUsage: { percent: 0.9, items: [] } } } },
    }),
  });
  assert.equal(result.usage, null, '已过期的套餐不再显示用量');
});
