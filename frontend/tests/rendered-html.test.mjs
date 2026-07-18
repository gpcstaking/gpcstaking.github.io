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
  assert.match(html, /社区收益全额烧伤规则/);
  assert.match(html, /社区收益为 0 并全部烧伤/);
  assert.match(html, /今日社区已收益/);
  assert.match(html, /今日尚未领取社区收益/);
  assert.match(html, /今日已领取/);
  assert.match(html, /链上到账/);
  assert.match(html, /动态收益/);
  assert.match(html, /GPC 销毁量/);
  assert.doesNotMatch(html, /今日可领取|今日预计/);
  assert.match(html, /aria-label="切换为英文">EN</);
  assert.match(html, /GPC首个链游—GPC传奇/);
  assert.match(html, /1GPC=10元宝/);
  assert.match(html, /进入游戏/);
  assert.match(html, /href="http:\/\/cq\.opengpc\.com"/);
  assert.doesNotMatch(html, /我的账户|查看 GPC 代币合约/);
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
  assert.match(source, /approve\(MINING_ADDRESS, ORDER_AMOUNT,/);
  assert.match(source, /授权 1 USDT/);
  assert.match(source, /directReferrals\(address\)/);
  assert.match(source, /branchPower\(address,address\)/);
  assert.match(source, /largestBranch\(address\)/);
  assert.match(source, /teamNodeCount\(address\)/);
  assert.match(source, /communityClaimedToday\(address\)/);
  assert.match(source, /直属节点数/);
  assert.match(source, /团队节点总数/);
  assert.match(source, /个人算力明细/);
  assert.match(source, /推广额度明细/);
  assert.match(source, /增减记录/);
  assert.match(source, /openLedger\("power"\)/);
  assert.match(source, /openLedger\("promotionQuota"\)/);
  assert.match(source, /event OrderPlaced/);
  assert.match(source, /event Withdrawn/);
  assert.match(source, /event PowerExpired/);
  assert.match(source, /质押增加/);
  assert.match(source, /领取收益消耗/);
  assert.match(source, /180 天未提现清零/);
  assert.match(source, /直推奖励消耗/);
  assert.match(source, /loadTodayClaims/);
  assert.match(source, /claimedTodayGpc/);
  assert.match(source, /claimedTodayStaticGpc/);
  assert.match(source, /claimedTodayDynamicGpc/);
  assert.match(source, /0x000000000000000000000000000000000000dEaD/);
  assert.match(source, /gpc\.balanceOf\(DEAD_ADDRESS\)/);
  assert.match(source, /"home" \| "order" \| "team" \| "ecosystem"/);
  assert.match(source, /switchTab\("ecosystem"\)/);
  assert.doesNotMatch(source, /activeTab !== "profile"|switchTab\("profile"\)/);
  assert.doesNotMatch(source, /bscscan\.com\/address\/\$\{snapshot\.parent\}/);
  assert.doesNotMatch(source, /bscscan\.com\/address\/\$\{referral\.address\}/);
  assert.match(source, /<div className="parent-row">/);
  assert.match(source, /<div className="direct-referral-row"/);
  assert.match(source, /伞下算力/);
  assert.match(source, /大区/);
  assert.match(source, /小区/);
  assert.match(source, /placeOrder\.staticCall/);
  assert.match(source, /TRANSACTION_GAS_HEADROOM_BPS = 3_000n/);
  assert.match(source, /gasLimitWithHeadroom/);
  assert.match(source, /bindReferral\.estimateGas/);
  assert.match(source, /approve\.estimateGas/);
  assert.match(source, /placeOrder\.estimateGas/);
  assert.match(source, /withdraw\.estimateGas/);
  assert.match(source, /0xf85bf639/);
  assert.match(source, /根节点钱包不能参与质押，请切换其他钱包/);
  assert.match(source, /0x613f0ee7/);
  assert.match(source, /0x73c5a6b0/);
  assert.doesNotMatch(source, /授权 1,000 USDT/);

  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.binding-modal input[^}]*font-size:\s*16px/s);
  assert.match(styles, /height:\s*100dvh/);
});
