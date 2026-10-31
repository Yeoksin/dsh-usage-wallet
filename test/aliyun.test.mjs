// dsh-deepseek-usage 阿里云余额补丁的确定性测试（node --test）。
// 不联网：签名用阿里云官方文档的 DescribeRegions 向量，HTTP 用注入的 fetch 替身。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  signRpcRequest,
  parseAliyunCashCoupons,
  parseAliyunAccountBalance,
  readAliyunBalance,
} from '../lib/aliyun.js';

test('signRpcRequest 与阿里云官方 RPC 签名示例一致', () => {
  // https://help.aliyun.com/document_detail/214820.html 的示例：
  // AK=testid / SK=testsecret / DescribeRegions / Version=2014-05-26 / Format=XML
  // 期望签名（RFC3986 编码前）：OLeaidS1JvxuMvnyHOwuJ+uX5qY=
  const url = signRpcRequest({
    accessKeyId: 'testid',
    accessKeySecret: 'testsecret',
    action: 'DescribeRegions',
    params: { Version: '2014-05-26', Format: 'XML' },
    now: new Date('2016-02-23T12:46:24Z'),
    nonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
  });
  const signature = new URL(url).searchParams.get('Signature');
  assert.equal(signature, 'OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  // 请求串本身也应与文档排序一致（AccessKeyId 在最前、Version 在最后）。
  assert.match(url, /AccessKeyId=testid&Action=DescribeRegions&Format=XML/);
});

test('parseAliyunCashCoupons 累加 Available 券的余额', () => {
  const body = {
    Success: true,
    Code: 'Success',
    Data: {
      CashCoupon: [
        { Status: 'Available', Balance: '30.5', NominalValue: '50.00' },
        { Status: 'Available', Balance: '12.25', NominalValue: '50.00' },
        { Status: 'Expired', Balance: '50.00', NominalValue: '50.00' },
        { Status: 'Cancelled', Balance: '99.00', NominalValue: '100.00' },
      ],
    },
  };
  const parsed = parseAliyunCashCoupons(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.balance.total, 42.75);
  assert.equal(parsed.balance.currency, 'CNY');
  assert.equal(parsed.balance.isAvailable, true);
  assert.equal(parsed.count, 2);
});

test('parseAliyunCashCoupons 没有 CashCoupon 字段 → empty（不是 shape）', () => {
  const parsed = parseAliyunCashCoupons({ Success: true, Code: 'Success', Data: {} });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'empty');
});

test('parseAliyunCashCoupons 响应是数组 / 数字 → shape', () => {
  for (const bad of [[], 1, 'x', null]) {
    const parsed = parseAliyunCashCoupons(bad);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, 'shape');
  }
});

test('parseAliyunAccountBalance 读取 AvailableAmount 与币种', () => {
  const parsed = parseAliyunAccountBalance({
    Success: true,
    Code: '200',
    Data: { AvailableAmount: '10000.00', AvailableCashAmount: '0.00', Currency: 'CNY' },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.balance.total, 10000);
  assert.equal(parsed.balance.currency, 'CNY');
});

test('parseAliyunAccountBalance 缺失金额 → empty（不能把 null 当 0）', () => {
  const parsed = parseAliyunAccountBalance({ Success: true, Data: { Currency: 'CNY' } });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'empty');
});

/** 用固定响应替换 fetch，记录被调用的 Action。 */
function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('Action');
      calls.push(action);
      const body = responses[action];
      if (body instanceof Error) throw body;
      return {
        status: typeof body === 'object' && body !== null && 'status' in body ? body.status : 200,
        text: async () => JSON.stringify(body.body ?? body),
      };
    },
  };
}

test('readAliyunBalance：有代金券时报券余额，不再查账户额度', async () => {
  const fake = fakeFetch({
    QueryCashCoupons: { Success: true, Data: { CashCoupon: [{ Status: 'Available', Balance: '18.80' }] } },
    QueryAccountBalance: { Success: true, Data: { AvailableAmount: '999.00', Currency: 'CNY' } },
  });
  const result = await readAliyunBalance({ accessKeyId: 'LTAIxxxx', accessKeySecret: 'secret', fetchImpl: fake.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.balance.total, 18.8);
  assert.equal(result.source, 'voucher');
  assert.deepEqual(fake.calls, ['QueryCashCoupons']);
});

test('readAliyunBalance：没有代金券时回落账户可用额度', async () => {
  const fake = fakeFetch({
    QueryCashCoupons: { Success: true, Data: {} },
    QueryAccountBalance: { Success: true, Data: { AvailableAmount: '66.60', Currency: 'CNY' } },
  });
  const result = await readAliyunBalance({ accessKeyId: 'LTAIxxxx', accessKeySecret: 'secret', fetchImpl: fake.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.balance.total, 66.6);
  assert.equal(result.source, 'account');
  assert.deepEqual(fake.calls, ['QueryCashCoupons', 'QueryAccountBalance']);
});

test('readAliyunBalance：AccessKey 无效 → unauthorized，且不再打第二个接口', async () => {
  const fake = fakeFetch({
    QueryCashCoupons: { status: 404, body: { Code: 'InvalidAccessKeyId.NotFound', Message: 'Specified access key is not found.' } },
    QueryAccountBalance: { Success: true, Data: { AvailableAmount: '1.00' } },
  });
  const result = await readAliyunBalance({ accessKeyId: 'LTAIbad', accessKeySecret: 'bad', fetchImpl: fake.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unauthorized');
  assert.equal(result.detail, 'InvalidAccessKeyId.NotFound');
  assert.deepEqual(fake.calls, ['QueryCashCoupons']);
});

test('readAliyunBalance：没有 BSS 只读权限 → unauthorized', async () => {
  const fake = fakeFetch({
    QueryCashCoupons: { status: 200, body: { Code: 'NoPermission', Message: 'You are not authorized to perform this action.' } },
  });
  const result = await readAliyunBalance({ accessKeyId: 'LTAIxxxx', accessKeySecret: 'secret', fetchImpl: fake.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unauthorized');
  assert.equal(result.detail, 'NoPermission');
});

test('readAliyunBalance：网络/超时 → network、timeout', async () => {
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const fake = fakeFetch({ QueryCashCoupons: timeout });
  assert.equal((await readAliyunBalance({ accessKeyId: 'a', accessKeySecret: 'b', fetchImpl: fake.fetchImpl })).code, 'timeout');

  const net = new TypeError('fetch failed');
  const fake2 = fakeFetch({ QueryCashCoupons: net });
  const r2 = await readAliyunBalance({ accessKeyId: 'a', accessKeySecret: 'b', fetchImpl: fake2.fetchImpl });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'network');
});