#!/usr/bin/env node
/**
 * 取回上游 dougen/dsh-deepseek-usage 的指定版本源码（默认 v0.16.0，即本分支基线），
 * 并检查本分支的补丁锚点在新版本里是否还找得到。
 *
 * 用法：
 *   node scripts/sync-upstream.mjs            # 取基线 v0.16.0 到 .upstream/<tag>
 *   node scripts/sync-upstream.mjs v0.18.16   # 取别的版本，看看补丁还差多少
 *
 * 注意：本仓库的 lib/*.js 已经是「上游 + 补丁」的成品，同步上游后需要把补丁重新
 * 应用到新基线上（改动点见 NOTICE.md 的表格），跑通 `npm test` 再发版。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tag = process.argv[2] ?? 'v0.16.0';
const outDir = path.join(ROOT, '.upstream');
const target = path.join(outDir, tag);

if (existsSync(target)) {
  console.log(`已存在：${target}（删掉后重跑可重新下载）`);
} else {
  mkdirSync(outDir, { recursive: true });
  const url = `https://codeload.github.com/dougen/dsh-deepseek-usage/tar.gz/refs/tags/${tag}`;
  console.log(`下载 ${url}`);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    console.error(`下载失败：${error.message}\n`);
    console.error('可以改用 git：');
    console.error(`  git clone --depth 1 --branch ${tag} https://github.com/dougen/dsh-deepseek-usage.git .upstream/${tag}`);
    process.exit(1);
  }
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tarball = path.join(outDir, `${tag}.tar.gz`);
  writeFileSync(tarball, buffer);
  mkdirSync(target, { recursive: true });
  const untar = spawnSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], { encoding: 'utf8' });
  if (untar.status !== 0) throw new Error(`解包失败：${untar.stderr}`);
  console.log(`已解包到 ${target}`);
}

// 补丁锚点自检：每个锚点必须在新基线里恰好出现一次，否则说明需要人工移植。
const ANCHORS = [
  ['lib/accounts.js', 'fallback: { host: \'https://openrouter.ai\', path: \'/api/v1/credits\', auth: \'bearer\' },\n  },\n};'],
  ['lib/accounts.js', 'export function candidateRefsOf(providerId) {'],
  ['lib/index.js', 'async function readBoundedText(response, limit = MAX_BODY_BYTES) {'],
  ['lib/index.js', 'raw = await readBoundedText(req, MAX_TOKEN_BODY_BYTES);'],
  ['lib/index.js', '  const refs = candidateRefsOf(providerId);\n  const resolved = await resolveCredential(ctx, refs);\n  if (!resolved.ok) {'],
  ['lib/client.js', '			const [saving, setSaving] = useState("");'],
  ['lib/client.js', '				// OAuth 令牌填写卡：只对 kind=oauth 的提供商渲染。'],
];
let missing = 0;
for (const [file, anchor] of ANCHORS) {
  const full = path.join(target, file);
  const text = existsSync(full) ? (await import('node:fs')).readFileSync(full, 'utf8') : '';
  const count = text === '' ? -1 : text.split(anchor).length - 1;
  const ok = count === 1;
  if (!ok) missing += 1;
  console.log(`${ok ? '✔' : '✘'} ${file}: 锚点出现 ${count} 次${ok ? '' : '（需要人工移植）'}`);
}
console.log(missing === 0 ? '\n所有锚点都在，可以直接重新应用补丁。' : `\n有 ${missing} 个锚点需要人工处理。`);