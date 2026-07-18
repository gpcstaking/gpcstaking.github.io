import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the GPC mining application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GPC Staking<\/title>/i);
  assert.match(html, /href="\/favicon.ico"/);
  assert.match(html, />STAKING<\/small>/);
  assert.match(html, /GPC质押挖矿/);
  assert.match(html, /我的团队/);
  assert.match(html, /直推下级/);
  assert.match(html, /今日收益/);
  assert.match(html, /aria-label="切换为英文">EN</);
  assert.match(html, /查看 GPC 代币合约/);
  assert.match(html, /10%.*筑 LP/);
  assert.match(html, /20%.*直推/);
  assert.match(html, /70%.*质押矿池/);
  assert.match(html, /测试阶段每次固定质押 1 USDT/);
  assert.match(html, /\+2 算力/);
  assert.match(html, /\+1 U 推广额度/);
  assert.doesNotMatch(html, /授权 1,000 USDT/);
  assert.doesNotMatch(html, /安全与风控|固定报单/);
  assert.doesNotMatch(html, /class="quick-actions"/);
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);

  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const ORDER_AMOUNT = 1n \* 10n \*\* 18n/);
  assert.match(source, /approve\(MINING_ADDRESS, ORDER_AMOUNT\)/);
  assert.match(source, /授权 1 USDT/);
  assert.match(source, /directReferrals\(address\)/);
  assert.match(source, /placeOrder\.staticCall/);
  assert.doesNotMatch(source, /授权 1,000 USDT/);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.binding-modal input[^}]*font-size:\s*16px/s);
  assert.match(styles, /height:\s*100dvh/);
});
