// MiMo API Key 通道的测试：前缀分类、校验（假网关）、宿主 /token 保存与状态页字段。
import test from 'node:test';
import assert from 'node:assert/strict';

import { miMoKeyKind, validateMiMoApiKey } from '../lib/mimo.js';
import { providerMiMoKeyOf } from '../lib/accounts.js';

test('miMoKeyKind：sk / tp / ttp / 其他', () => {
  assert.equal(miMoKeyKind('sk-abc123'), 'sk');
  assert.equal(miMoKeyKind('tp-abc123'), 'tp');
  assert.equal(miMoKeyKind('ttp-abc123'), 'ttp');
  assert.equal(miMoKeyKind('abc'), 'unknown');
  assert.equal(miMoKeyKind(''), 'unknown');
  assert.equal(miMoKeyKind(null), 'unknown');
});

/** 假网关：记录请求，按 host 决定响应。 */
function gateway(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const host = new URL(url).host;
    calls.push({ host, url: String(url), auth: init?.headers?.authorization });
    const handler = routes[host];
    if (handler === undefined) return { status: 404, text: async () => '' };
    return handler(init);
  };
  impl.calls = calls;
  return impl;
}

test('validateMiMoApiKey：sk- 走按量网关，通过后返回模型列表', async () => {
  const fetchImpl = gateway({
    'api.xiaomimimo.com': () => ({ status: 200, text: async () => JSON.stringify({ data: [{ id: 'mimo-v2.6-flash' }, { id: 'mimo-v2.6-pro' }, 'text-embedding' ] }) }),
  });
  const r = await validateMiMoApiKey({ key: 'sk-test', fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'sk');
  assert.equal(r.count, 3);
  assert.deepEqual(r.models, ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'text-embedding']);
  assert.equal(fetchImpl.calls[0].host, 'api.xiaomimimo.com');
  assert.equal(fetchImpl.calls[0].auth, 'Bearer sk-test');
});

test('validateMiMoApiKey：tp- 依次试三个集群，第一个 401 后回落到能通的那个', async () => {
  const fetchImpl = gateway({
    'token-plan-cn.xiaomimimo.com': () => ({ status: 401, text: async () => '{}' }),
    'token-plan-sgp.xiaomimimo.com': () => ({ status: 200, text: async () => JSON.stringify({ data: [{ id: 'mimo-v2.6-flash' }] }) }),
  });
  const r = await validateMiMoApiKey({ key: 'tp-test', fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.host, 'token-plan-sgp.xiaomimimo.com');
  assert.equal(fetchImpl.calls.length, 2);
});

test('validateMiMoApiKey：全 401 → unauthorized；网关异常 → network；超时 → timeout', async () => {
  assert.equal((await validateMiMoApiKey({ key: 'sk-x', fetchImpl: gateway({}) })).ok, false);
  assert.equal((await validateMiMoApiKey({ key: 'sk-x', fetchImpl: gateway({ 'api.xiaomimimo.com': () => ({ status: 401, text: async () => '{}' }) }) })).code, 'unauthorized');
  assert.equal((await validateMiMoApiKey({ key: 'sk-x', fetchImpl: gateway({ 'api.xiaomimimo.com': () => ({ status: 500, text: async () => '' }) }) })).code, 'network');
  const timeout = new Error('t'); timeout.name = 'TimeoutError';
  const thrower = async () => { throw timeout; };
  assert.equal((await validateMiMoApiKey({ key: 'sk-x', fetchImpl: thrower })).code, 'timeout');
});

test('validateMiMoApiKey：前缀非法直接拒绝，不发请求', async () => {
  const fetchImpl = gateway({});
  const r = await validateMiMoApiKey({ key: 'garbage', fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'badKey');
  assert.equal(fetchImpl.calls.length, 0);
});

test('providerMiMoKeyOf：MiMo 与别名有 Key 通道，其它 provider 没有', () => {
  for (const id of ['mimo', 'xiaomi', 'xiaomimimo']) {
    assert.deepEqual(providerMiMoKeyOf(id), { refs: ['MIMO_API_KEY'] }, id);
  }
  assert.equal(providerMiMoKeyOf('qwen-token-plan'), null);
  assert.equal(providerMiMoKeyOf('deepseek'), null);
});