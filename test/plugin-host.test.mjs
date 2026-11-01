// 宿主侧集成测试：加载打补丁后的 lib/index.js，起一个真的 node:http 服务器跑通
// 「写入 AK/SK → 主卡片读到阿里云代金券余额 → 状态页列出行」的整条链路。
//
// 用真实 HTTP 而不是手搓 req 对象，是因为上一版补丁就栽在这上面：DSH 的 webServer
// 交给路由的是 node:http 的 IncomingMessage（headers 是普通对象、body 是流），
// 按 fetch Response 写（headers.get/text）会在真实请求下抛错并回 413。

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { apply } from '../lib/index.js';

/** BSS 假响应：按 Action 分派，模拟阿里云 RPC 的 JSON 形状。 */
function makeBssFetch(handler) {
  return async (url) => {
    const u = new URL(url);
    const action = u.searchParams.get('Action');
    assert.ok(u.searchParams.get('Signature'), '请求必须带 Signature');
    assert.equal(u.searchParams.get('SignatureMethod'), 'HMAC-SHA1');
    const result = handler(action);
    const status = result.status ?? 200;
    return { status, text: async () => JSON.stringify(result.body) };
  };
}

/** 一个最小可用的插件宿主替身。 */
function makeCtx({ currentProvider = 'qwen-token-plan' } = {}) {
  const routes = new Map();
  const store = new Map();
  const ctx = {
    effect(fn) { return fn(); },
    logger: { warn() {} },
    webServer: {
      host: '127.0.0.1',
      register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); },
    },
    credentials: {
      async resolve(ref) {
        const name = ref && ref.__credentialRef;
        return store.has(name) ? { value: store.get(name) } : undefined;
      },
      async set(ref, value) { store.set(ref.__credentialRef, value); },
      async unset(ref) { store.delete(ref.__credentialRef); },
    },
    get(name) {
      if (name !== 'agentDefaultModel') return undefined;
      return { currentSelection: () => ({ provider: currentProvider, model: 'deepseek-v4.1-flash' }) };
    },
  };
  apply(ctx);
  return { routes, store };
}

/** 把插件路由挂到真实的 node:http 服务器上。 */
async function startServer(routes) {
  const server = http.createServer((req, res) => {
    const path = String(req.url ?? '/').split('?')[0];
    const handler = routes.get(path);
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error) }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** 装好 BSS 假 fetch（对本地 HTTP 的请求仍然走真 fetch）。 */
function installFetch(handler) {
  const realFetch = globalThis.fetch;
  const bss = makeBssFetch(handler);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.includes('business.aliyuncs.com')) return bss(url, init);
    return realFetch(input, init);
  };
  return () => { globalThis.fetch = realFetch; };
}

const json = async (res) => ({ status: res.status, body: await res.json() });

test('没有 AK/SK 时主卡片给出「未配置」提示，而不是要求配 API Key', async () => {
  const { routes } = makeCtx();
  const server = await startServer(routes);
  try {
    const { status, body } = await json(await fetch(`${server.base}/api/usage-wallet?lang=zh`));
    assert.equal(status, 200);
    assert.equal(body.provider.id, 'qwen-token-plan');
    assert.equal(body.provider.kind, 'balance');
    assert.equal(body.balance.total, null);
    assert.ok(body.errors.some((e) => e.includes('阿里云 AccessKey')), JSON.stringify(body.errors));
  } finally {
    await server.close();
  }
});

test('真实 HTTP POST 能写入 AK/SK，主卡片随即显示代金券余额合计', async () => {
  const { routes, store } = makeCtx();
  const restore = installFetch(() => ({
    body: {
      Success: true,
      Code: 'Success',
      Data: { CashCoupon: [
        { Status: 'Available', Balance: '30.50' },
        { Status: 'Available', Balance: '12.25' },
        { Status: 'Expired', Balance: '50.00' },
      ] },
    },
  }));
  const server = await startServer(routes);
  try {
    const saved = await json(await fetch(`${server.base}/api/usage-wallet/token?lang=zh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: 'LTAI5tTestKeyId', accessKeySecret: 'testSecretValue123456' }),
    }));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.ok, true);
    assert.equal(saved.body.configured, true);
    // 保存后宿主会立刻自检并把读数一起回给界面。
    assert.equal(saved.body.check.ok, true, JSON.stringify(saved.body.check));
    assert.equal(saved.body.check.total, 42.75);
    assert.equal(store.get('QWEN_TOKEN_PLAN_ACCESS_KEY_ID'), 'LTAI5tTestKeyId');
    assert.equal(store.get('QWEN_TOKEN_PLAN_ACCESS_KEY_SECRET'), 'testSecretValue123456');

    const main = await json(await fetch(`${server.base}/api/usage-wallet?lang=zh`));
    assert.equal(main.body.ok, true);
    assert.deepEqual(main.body.errors, []);
    assert.equal(main.body.balance.total, 42.75);
    assert.equal(main.body.balance.currency, 'CNY');

    const cleared = await json(await fetch(`${server.base}/api/usage-wallet/token?lang=zh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: '', accessKeySecret: '' }),
    }));
    assert.equal(cleared.body.configured, false);
    assert.equal(store.has('QWEN_TOKEN_PLAN_ACCESS_KEY_ID'), false);
  } finally {
    await server.close();
    restore();
  }
});

test('状态页：list=1 先给出 AK/SK 配置状态，完整请求再填上余额', async () => {
  const { routes } = makeCtx();
  const restore = installFetch(() => ({
    body: { Success: true, Code: 'Success', Data: { CashCoupon: [{ Status: 'Available', Balance: '8.00' }] } },
  }));
  const server = await startServer(routes);
  try {
    await fetch(`${server.base}/api/usage-wallet/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: 'LTAI5tTestKeyId', accessKeySecret: 'testSecretValue123456' }),
    });

    const list = await json(await fetch(`${server.base}/api/usage-wallet/accounts?list=1`));
    const row = list.body.accounts.find((a) => a.id === 'qwen-token-plan');
    assert.ok(row, '状态页应出现 qwen-token-plan 行');
    assert.equal(row.kind, 'balance');
    assert.equal(row.multi, 'aliyun-aksk');
    assert.equal(row.credential.configured, true);
    assert.equal(row.status, 'pending');
    assert.deepEqual(row.refs, [
      'QWEN_TOKEN_PLAN_ACCESS_KEY_ID',
      'ALIBABA_CLOUD_ACCESS_KEY_ID',
      'QWEN_TOKEN_PLAN_ACCESS_KEY_SECRET',
      'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    ]);

    const full = await json(await fetch(`${server.base}/api/usage-wallet/accounts`));
    const fullRow = full.body.accounts.find((a) => a.id === 'qwen-token-plan');
    assert.equal(fullRow.status, 'ok');
    assert.equal(fullRow.balance.total, 8);
  } finally {
    await server.close();
    restore();
  }
});

test('AccessKey 无效时主卡片提示去改 AccessKey', async () => {
  const { routes } = makeCtx();
  const restore = installFetch(() => ({
    status: 404,
    body: { Code: 'InvalidAccessKeyId.NotFound', Message: 'Specified access key is not found.', RequestId: 'x' },
  }));
  const server = await startServer(routes);
  try {
    await fetch(`${server.base}/api/usage-wallet/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: 'LTAI5tBad', accessKeySecret: 'badSecret' }),
    });
    const main = await json(await fetch(`${server.base}/api/usage-wallet?lang=zh`));
    assert.equal(main.body.balance.total, null);
    // 细分文案：AK 不存在（而不是笼统的「AccessKey 无效」）。
    assert.ok(main.body.errors.some((e) => e.includes('不存在')), JSON.stringify(main.body.errors));
  } finally {
    await server.close();
    restore();
  }
});

test('只填半对 AK/SK 被拒绝；非本机 Host 的请求被 403', async () => {
  const { routes } = makeCtx();
  const server = await startServer(routes);
  try {
    const half = await json(await fetch(`${server.base}/api/usage-wallet/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: 'LTAI5tTestKeyId' }),
    }));
    assert.equal(half.status, 400);
  } finally {
    await server.close();
  }

  const { routes: routes2 } = makeCtx();
  const server2 = await startServer(routes2);
  try {
    const port = new URL(server2.base).port;
    const blocked = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/api/usage-wallet',
        method: 'GET',
        headers: { Host: 'evil.example.com' },
      }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(blocked.status, 403);
  } finally {
    await server2.close();
  }
});

test('Request 形态的请求体（IPC 桥/测试替身）也能解析', async () => {
  const { routes } = makeCtx();
  const handler = routes.get('/api/usage-wallet/token');
  const payload = JSON.stringify({ provider: 'qwen-token-plan', accessKeyId: 'LTAI5tX', accessKeySecret: 'y' });
  const fakeReq = {
    method: 'POST',
    url: '/api/usage-wallet/token',
    headers: { host: '127.0.0.1:1', 'content-length': String(Buffer.byteLength(payload)) },
    text: async () => payload,
  };
  const result = await new Promise((resolve, reject) => {
    const res = {
      headersSent: false,
      writeHead(status) { this.statusCode = status; this.headersSent = true; },
      end(chunk) { resolve({ status: this.statusCode, body: JSON.parse(chunk) }); },
    };
    Promise.resolve(handler(fakeReq, res)).catch(reject);
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.configured, true);
});
test('当前 provider 是别名（xiaomi）时：主卡片认作余额类，且状态页只有一张 MiMo 卡', async () => {
  const { routes } = makeCtx({ currentProvider: 'xiaomi' });
  const server = await startServer(routes);
  try {
    const main = await json(await fetch(`${server.base}/api/usage-wallet?lang=zh`));
    assert.equal(main.body.provider.id, 'xiaomi');
    assert.equal(main.body.provider.kind, 'balance', '别名应解析到 MiMo 的余额能力');

    const list = await json(await fetch(`${server.base}/api/usage-wallet/accounts?list=1`));
    const mimoCards = list.body.accounts.filter((a) => a.multi === 'mimo-cookie');
    assert.equal(mimoCards.length, 1, '只应有一张 MiMo Cookie 卡：' + mimoCards.map((a) => a.id).join(','));
    assert.equal(mimoCards[0].id, 'xiaomi', '保留的是当前 provider 那一行');
    assert.equal(mimoCards[0].current, true);
  } finally {
    await server.close();
  }
});

test('MiMo API Key：非法前缀被拒（不发网络请求），空值即清除', async () => {
  const { routes } = makeCtx();
  const server = await startServer(routes);
  try {
    const bad = await json(await fetch(`${server.base}/api/usage-wallet/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: new URL(server.base).host },
      body: JSON.stringify({ provider: 'mimo', apiKey: 'not-a-key' }),
    }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.ok, false);

    const cleared = await json(await fetch(`${server.base}/api/usage-wallet/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: new URL(server.base).host },
      body: JSON.stringify({ provider: 'mimo', apiKey: '' }),
    }));
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.configured, false);
  } finally {
    await server.close();
  }
});

test('只填 MiMo API Key、缺 Cookie：状态是 key-only（不误报 no-key）', async () => {
  const { routes, store } = makeCtx({ currentProvider: 'mimo' });
  store.set('MIMO_API_KEY', 'sk-live-key'); // 只存 Key，不存 MIMO_COOKIE
  const server = await startServer(routes);
  try {
    const list = await json(await fetch(`${server.base}/api/usage-wallet/accounts?list=1`));
    const mimo = list.body.accounts.find((a) => a.multi === 'mimo-cookie');
    assert.ok(mimo, '应有 MiMo 行');
    assert.equal(mimo.status, 'key-only', '只填 Key 时应是 key-only，而非 no-key');
    assert.equal(mimo.apiKey.configured, true, 'API Key 已配置');
    assert.equal(mimo.cookie.configured, false, 'Cookie 未配置');
    // 全都没填时才回到 no-key
    store.delete('MIMO_API_KEY');
    const list2 = await json(await fetch(`${server.base}/api/usage-wallet/accounts?list=1`));
    assert.equal(list2.body.accounts.find((a) => a.multi === 'mimo-cookie').status, 'no-key');
  } finally {
    await server.close();
  }
});
