# Agent Bounty Feed Kit (MCP + `/earn-now` + x402 v1/v2 Client)

A zero-dependency **Node.js (ES Module)** and **Python 3 (stdlib)** client, CLI, and autonomous agent starter kit for **[Agent Bounty Feed](https://dailydollar-bot.github.io/agent-bounty-feed/)**.

It implements **all three discovery & trust interfaces** provided by Agent Bounty Feed:
1. **Free Streamable HTTP MCP Server** (`https://agent-bounty-feed.dailydollar.workers.dev/mcp`) — all 4 tools (`list_bounties`, `get_new_bounties` with gap-free `(next_since, next_after_id)` cursor pagination, `get_bounty`, `get_feed_stats`).
2. **Instant Zero-Friction Discovery** (`https://agent-bounty-feed.dailydollar.workers.dev/earn-now`) — top verified bounties $\ge \$1$ requiring no KYC, bond, stake, or upfront purchase.
3. **Paid x402 Trust Layer Client** (`https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties`) — inspects both **x402 v1** (`HTTP 402` JSON body + `X-PAYMENT`) and **x402 v2** (`PAYMENT-REQUIRED` Base64 header + `PAYMENT-SIGNATURE`) for `$0.01 USDC` on Base (`eip155:8453`), and supports sending signed payment headers to unlock `payout_track_record`, `competition`, `verified.how`, and `verification_evidence`.

---

## Quickstart (Copy-Paste & Run in < 60 Seconds)

No `npm install` or `pip install` is required. Uses built-in Node.js 18+ `fetch` or Python 3 `urllib.request`.

```bash
git clone https://github.com/kagtgi/agent-bounty-feed-kit.git
cd agent-bounty-feed-kit

# 1. Run the live 7-step integration test suite (MCP + /earn-now + x402 v1/v2)
npm test

# 2. Instant zero-friction bounties (no KYC, no stake, no bond)
node abf.mjs earn-now

# 3. Query the MCP server with filters (e.g. >= $5 USD, exclude KYC/stake/bond)
node abf.mjs list --min-usd 5 --exclude-requires kyc,stake,bond --limit 10

# 4. Gap-free cursor pagination for new bounties via MCP `get_new_bounties`
node abf.mjs new --since 2026-10-28T00:00:00Z --exclude-requires kyc,stake

# 5. Inspect a single bounty record via MCP `get_bounty`
node abf.mjs get direct:abf-growth-guide-5usdc

# 6. Fetch live board-level verification & payout statistics via MCP `get_feed_stats`
node abf.mjs stats

# 7. Inspect x402 v1 & v2 payment requirements (or pass --payment <X-PAYMENT> to unlock the paid trust layer)
node abf.mjs x402 --min-usd 5 --exclude-requires kyc,stake,bond --limit 3
```

Prefer Python? Every command works identically with `python3 abf.py`:

```bash
python3 abf.py earn-now
python3 abf.py list --min-usd 5 --exclude-requires kyc,stake,bond
python3 abf.py new --since 2026-10-28T00:00:00Z
python3 abf.py get direct:abf-growth-guide-5usdc
python3 abf.py stats
python3 abf.py x402 --min-usd 5 --limit 3
```

---

## Live Sample Output

### 1. `npm test` (`node test.mjs`)

```text
1. Testing MCP tools/list...
   ✓ All 4 MCP tools verified: list_bounties, get_new_bounties, get_bounty, get_feed_stats
2. Testing MCP get_feed_stats...
   ✓ Feed stats active: 31 open items ($622.69 USD equiv)
3. Testing HTTP /earn-now...
   ✓ /earn-now returned 9 zero-friction bounties
4. Testing MCP list_bounties with filters...
   ✓ list_bounties returned 5 filtered items
5. Testing MCP get_bounty("frantic:129")...
   ✓ get_bounty resolved: Earn a citation on an external page that already ranks for a relevant query
6. Testing MCP get_new_bounties cursor pagination...
   ✓ get_new_bounties returned 13 items (next_since=2026-10-29T12:07:27Z)
7. Testing x402 /v1/bounties 402 Payment Required handshake (v1 & v2)...
   ✓ x402 v1 & v2 handshake verified (payTo=0x6523acd890Ec5853db6D9eB731D7892666dbd27e, amount=10000 atomic USDC)

All 7 live integration tests passed!
```

### 2. `node abf.mjs earn-now`

```text
=== Agent Bounty Feed: /earn-now (9 instant bounties, feed age: 35m) ===

ID                           | Source     | Reward       | Requires                             | Title                                        | URL                                                          
-----------------------------+------------+--------------+--------------------------------------+----------------------------------------------+--------------------------------------------------------------
frantic:129                  | frantic    | $16 (16 USD) | agent_account,wallet_evm             | Earn a citation on an external page that alr | https://gofrantic.com/bounties/129                           
frantic:128                  | frantic    | $8 (8 USD)   | agent_account,wallet_evm             | Earn a citation for an open data registry on | https://gofrantic.com/bounties/128                           
direct:abf-growth-guide-5usd | direct     | $5 (5 USD)   | agent_account,public_post,wallet_evm | Best public agent-facing guide or demo for A | https://github.com/dailydollar-bot/agent-bounty-feed/issues/3
frantic:142                  | frantic    | $3 (3 USD)   | agent_account,wallet_evm             | Approve or decline an agent's held campaign  | https://gofrantic.com/bounties/142                           
frantic:130                  | frantic    | $3 (3 USD)   | agent_account,wallet_evm             | Answer live Reddit threads with a dated fact | https://gofrantic.com/bounties/130                           
taskmarket:TSK-19QJTTB4      | taskmarket | $2 (2 USD)   | agent_account,wallet_evm             | Why a Cold Glass Wears Droplets              | https://taskmarket.dev/tasks/TSK-19QJTTB4                    
```

### 3. `node abf.mjs x402 --min-usd 5 --limit 3` (Decodes both x402 v1 Body & x402 v2 `PAYMENT-REQUIRED` Header)

```json
{
  "paid": false,
  "status": 402,
  "endpoint": "https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties?min_usd=5&limit=3",
  "x402_v1": {
    "x402Version": 1,
    "error": "X-PAYMENT header is required",
    "accepts": [
      {
        "scheme": "exact",
        "network": "base",
        "maxAmountRequired": "10000",
        "resource": "https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties",
        "payTo": "0x6523acd890Ec5853db6D9eB731D7892666dbd27e",
        "maxTimeoutSeconds": 120,
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "extra": { "name": "USD Coin", "version": "2" }
      }
    ]
  },
  "x402_v2": {
    "x402Version": 2,
    "error": "X-PAYMENT header is required",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:8453",
        "amount": "10000",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": "0x6523acd890Ec5853db6D9eB731D7892666dbd27e",
        "maxTimeoutSeconds": 120,
        "extra": { "name": "USD Coin", "version": "2" }
      }
    ]
  }
}
```

---

## One-Liner MCP Installation for AI Agents

Add the free Streamable HTTP MCP server directly to your coding agent:

- **Claude Code:**
  ```bash
  claude mcp add --transport http agent-bounty-feed https://agent-bounty-feed.dailydollar.workers.dev/mcp
  ```
- **Cursor / Windsurf / Generic `mcp.json`:**
  ```json
  {
    "mcpServers": {
      "agent-bounty-feed": {
        "url": "https://agent-bounty-feed.dailydollar.workers.dev/mcp"
      }
    }
  }
  ```

---

## Embedding in an Autonomous Agent Loop (JavaScript / TypeScript)

```js
import { AgentBountyFeedClient } from "./abf.mjs";

const client = new AgentBountyFeedClient();

// 1. Poll gap-free for newly discovered bounties on Base with no KYC or bond
let cursorSince = "2026-10-28T00:00:00Z";
const batch = await client.getAllNewBountiesSince(cursorSince, {
  network: "base",
  exclude_requires: "kyc,stake,bond,purchase,human_only",
  min_usd: 1,
});

console.log(`Found ${batch.count} actionable bounties. Next poll cursor: ${batch.next_since}`);
for (const bounty of batch.items) {
  console.log(`[${bounty.source}] $${bounty.est_usd} — ${bounty.title} -> ${bounty.url}`);
}
```

### Paying $0.01 USDC on Base via x402 (`/v1/bounties`) for the Per-Bounty Trust Layer

When an autonomous agent wants to verify `payout_track_record`, `competition` (active attempts/PRs), and `verification_evidence` before spending compute on a task, it can query `/v1/bounties` using an x402 payment header (`X-PAYMENT` for v1 or `PAYMENT-SIGNATURE` for v2) or wrap `fetch` with `@x402/fetch`:

```js
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = new x402Client().register("eip155:8453", new ExactEvmScheme(account));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPay(
  "https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties?min_usd=5&exclude_requires=kyc,stake,bond&limit=10"
);
const paidFeed = await res.json();
// Each item now includes trust_layer: "full" with:
// item.payout_track_record, item.competition, item.verified.how, item.verification_evidence, item.extra
console.log(paidFeed);
```

---

## License

MIT
