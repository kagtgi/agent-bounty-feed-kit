import assert from "node:assert/strict";
import { AgentBountyFeedClient } from "./abf.mjs";

async function runTests() {
  const client = new AgentBountyFeedClient();

  console.log("1. Testing MCP tools/list...");
  const tools = await client.listMcpTools();
  const toolNames = tools.map((t) => t.name);
  assert.ok(toolNames.includes("list_bounties"), "Missing list_bounties tool");
  assert.ok(toolNames.includes("get_new_bounties"), "Missing get_new_bounties tool");
  assert.ok(toolNames.includes("get_bounty"), "Missing get_bounty tool");
  assert.ok(toolNames.includes("get_feed_stats"), "Missing get_feed_stats tool");
  console.log("   ✓ All 4 MCP tools verified:", toolNames.join(", "));

  console.log("2. Testing MCP get_feed_stats...");
  const statsRes = await client.getFeedStats();
  const stats = statsRes.stats || statsRes;
  assert.ok(typeof stats.items === "number", "Expected stats.items to be a number");
  assert.ok(typeof stats.total_usd === "number", "Expected stats.total_usd to be a number");
  console.log(`   ✓ Feed stats active: ${stats.items} open items ($${stats.total_usd} USD equiv)`);

  console.log("3. Testing HTTP /earn-now...");
  const earnNow = await client.getEarnNow();
  assert.ok(Array.isArray(earnNow.items), "Expected earnNow.items array");
  console.log(`   ✓ /earn-now returned ${earnNow.count} zero-friction bounties`);

  console.log("4. Testing MCP list_bounties with filters...");
  const listed = await client.listBounties({ min_usd: 1, exclude_requires: "kyc,stake,bond", limit: 5 });
  assert.ok(Array.isArray(listed.items), "Expected listed.items array");
  console.log(`   ✓ list_bounties returned ${listed.items.length} filtered items`);

  if (listed.items.length > 0) {
    const firstId = listed.items[0].id;
    console.log(`5. Testing MCP get_bounty("${firstId}")...`);
    const singleRes = await client.getBounty(firstId);
    const single = singleRes.item || singleRes;
    assert.equal(single.id, firstId, "Bounty ID mismatch");
    console.log(`   ✓ get_bounty resolved: ${single.title}`);
  }

  console.log("6. Testing MCP get_new_bounties cursor pagination...");
  const yesterday = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const newBounties = await client.getAllNewBountiesSince(yesterday, { limit: 10 });
  assert.ok(Array.isArray(newBounties.items), "Expected newBounties.items array");
  assert.ok(typeof newBounties.next_since === "string", "Expected next_since cursor");
  console.log(`   ✓ get_new_bounties returned ${newBounties.count} items (next_since=${newBounties.next_since})`);

  console.log("7. Testing x402 /v1/bounties 402 Payment Required handshake (v1 & v2)...");
  const x402 = await client.queryX402Bounties({ min_usd: 5, limit: 3 });
  assert.equal(x402.status, 402, "Expected HTTP 402 for unpaid request");
  assert.equal(x402.x402_v1.x402Version, 1, "Expected x402 v1 body");
  assert.equal(x402.x402_v2.x402Version, 2, "Expected x402 v2 PAYMENT-REQUIRED header");
  console.log(`   ✓ x402 v1 & v2 handshake verified (payTo=${x402.x402_v1.accepts[0].payTo}, amount=${x402.x402_v1.accepts[0].maxAmountRequired} atomic USDC)`);

  console.log("\nAll 7 live integration tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
