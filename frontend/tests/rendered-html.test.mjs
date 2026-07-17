import assert from "node:assert/strict";
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
  assert.match(html, /<title>GPC Mining Protocol<\/title>/i);
  assert.match(html, /固定报单/);
  assert.match(html, /我的团队/);
  assert.match(html, /今日收益/);
  assert.match(html, />BSC</);
  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
