#!/usr/bin/env node
/**
 * Agent Bounty Feed — Zero-Dependency MCP, /earn-now & x402 Client
 * Requires Node.js 18+ (built-in fetch & crypto, zero npm dependencies).
 *
 * Supports:
 *  - Streamable HTTP MCP tools: list_bounties, get_new_bounties, get_bounty, get_feed_stats
 *  - Instant zero-friction discovery: GET /earn-now
 *  - Static feed: GET /feed.json
 *  - x402 v1/v2 payment requirement inspection & EIP-3009 TransferWithAuthorization signing for GET /v1/bounties
 */

const MCP_URL = "https://agent-bounty-feed.dailydollar.workers.dev/mcp";
const EARN_NOW_URL = "https://agent-bounty-feed.dailydollar.workers.dev/earn-now";
const X402_URL = "https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties";
const FEED_URL = "https://dailydollar-bot.github.io/agent-bounty-feed/feed.json";

export class AgentBountyFeedClient {
  constructor({ mcpUrl = MCP_URL, earnNowUrl = EARN_NOW_URL, x402Url = X402_URL, feedUrl = FEED_URL } = {}) {
    this.mcpUrl = mcpUrl;
    this.earnNowUrl = earnNowUrl;
    this.x402Url = x402Url;
    this.feedUrl = feedUrl;
    this._rpcId = 1;
  }

  /**
   * Call a tool on the Streamable HTTP MCP server.
   */
  async callMcpTool(name, args = {}) {
    const cleanArgs = {};
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== null && v !== "") {
        cleanArgs[k] = v;
      }
    }

    const payload = {
      jsonrpc: "2.0",
      id: this._rpcId++,
      method: "tools/call",
      params: {
        name,
        arguments: cleanArgs,
      },
    };

    const res = await fetch(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`MCP RPC Error (${data.error.code}): ${data.error.message}`);
    }

    const result = data.result || {};
    if (result.isError) {
      const errText = result.content?.[0]?.text || JSON.stringify(result);
      throw new Error(`MCP Tool Error: ${errText}`);
    }

    const textBlock = result.content?.find((c) => c.type === "text")?.text;
    if (textBlock) {
      try {
        return JSON.parse(textBlock);
      } catch {
        return textBlock;
      }
    }
    return result;
  }

  /**
   * List available tools from the MCP server.
   */
  async listMcpTools() {
    const payload = {
      jsonrpc: "2.0",
      id: this._rpcId++,
      method: "tools/list",
      params: {},
    };
    const res = await fetch(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.result?.tools || [];
  }

  /**
   * MCP: list_bounties
   */
  async listBounties(filters = {}) {
    return this.callMcpTool("list_bounties", filters);
  }

  /**
   * MCP: get_new_bounties (cursor-paginated strictly after `since`)
   */
  async getNewBounties({ since, after_id, ...filters } = {}) {
    if (!since) throw new Error("`since` (ISO-8601 timestamp) is required for get_new_bounties");
    return this.callMcpTool("get_new_bounties", { since, after_id, ...filters });
  }

  /**
   * Auto-paginate all new bounties since a timestamp using (next_since, next_after_id)
   */
  async getAllNewBountiesSince(since, filters = {}) {
    const allItems = [];
    let curSince = since;
    let curAfterId = undefined;
    while (true) {
      const page = await this.getNewBounties({
        since: curSince,
        after_id: curAfterId,
        ...filters,
      });
      if (Array.isArray(page.items)) {
        allItems.push(...page.items);
      }
      if (!page.has_more) {
        return {
          count: allItems.length,
          next_since: page.next_since,
          items: allItems,
        };
      }
      curSince = page.next_since;
      curAfterId = page.next_after_id;
    }
  }

  /**
   * MCP: get_bounty
   */
  async getBounty(id) {
    if (!id) throw new Error("Bounty `id` is required");
    return this.callMcpTool("get_bounty", { id });
  }

  /**
   * MCP: get_feed_stats
   */
  async getFeedStats() {
    return this.callMcpTool("get_feed_stats", {});
  }

  /**
   * HTTP: GET /earn-now (top 15 verified bounties >= $1 needing no KYC/stake/bond/purchase)
   */
  async getEarnNow() {
    const res = await fetch(this.earnNowUrl, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) throw new Error(`/earn-now HTTP ${res.status}`);
    return res.json();
  }

  /**
   * HTTP: GET /v1/bounties — Inspect or execute x402 paid trust-layer query ($0.01 USDC on Base).
   * If `paymentHeader` is provided, sends `X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2).
   * If omitted, parses and decodes both the HTTP 402 JSON body (x402 v1) and the Base64 `PAYMENT-REQUIRED` header (x402 v2).
   */
  async queryX402Bounties(params = {}, { paymentHeader, paymentVersion = 1 } = {}) {
    const url = new URL(this.x402Url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    const headers = { "Accept": "application/json" };
    if (paymentHeader) {
      if (paymentVersion === 2) {
        headers["PAYMENT-SIGNATURE"] = paymentHeader;
      } else {
        headers["X-PAYMENT"] = paymentHeader;
      }
    }

    const res = await fetch(url.toString(), { headers });
    if (res.status === 402) {
      const v1Body = await res.json().catch(() => null);
      const paymentReqB64 = res.headers.get("payment-required");
      let v2Header = null;
      if (paymentReqB64) {
        try {
          v2Header = JSON.parse(Buffer.from(paymentReqB64, "base64").toString("utf8"));
        } catch {
          v2Header = paymentReqB64;
        }
      }
      return {
        paid: false,
        status: 402,
        endpoint: url.toString(),
        x402_v1: v1Body,
        x402_v2: v2Header,
      };
    }

    if (!res.ok) {
      throw new Error(`/v1/bounties HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      paid: true,
      status: res.status,
      paymentResponse: res.headers.get("x-payment-response") || res.headers.get("payment-response"),
      data,
    };
  }
}

function formatTable(items) {
  if (!items || items.length === 0) return "No matching bounties found.";
  const rows = items.map((b) => ({
    ID: String(b.id || "").slice(0, 28),
    Source: String(b.source || ""),
    Reward: b.est_usd != null ? `$${b.est_usd} (${b.reward ?? b.est_usd} ${b.currency || "USD"})` : `${b.reward ?? "?"} ${b.currency || ""}`,
    Requires: Array.isArray(b.requires) ? b.requires.join(",") || "none" : "none",
    Title: String(b.title || "").slice(0, 44),
    URL: String(b.url || ""),
  }));

  const cols = ["ID", "Source", "Reward", "Requires", "Title", "URL"];
  const widths = {};
  for (const c of cols) {
    widths[c] = Math.max(c.length, ...rows.map((r) => r[c].length));
  }

  const header = cols.map((c) => c.padEnd(widths[c])).join(" | ");
  const sep = cols.map((c) => "-".repeat(widths[c])).join("-+-");
  const body = rows.map((r) => cols.map((c) => r[c].padEnd(widths[c])).join(" | ")).join("\n");
  return `${header}\n${sep}\n${body}`;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        args[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          args[token.slice(2)] = next;
          i++;
        } else {
          args[token.slice(2)] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";
  const client = new AgentBountyFeedClient();
  const asJson = Boolean(args.json);

  if (cmd === "earn-now") {
    const res = await client.getEarnNow();
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`=== Agent Bounty Feed: /earn-now (${res.count} instant bounties, feed age: ${res.feed_age_minutes}m) ===\n`);
      console.log(formatTable(res.items));
    }
  } else if (cmd === "list") {
    const filters = {
      source: args.source,
      min_usd: args["min-usd"] != null ? Number(args["min-usd"]) : undefined,
      network: args.network,
      exclude_requires: args["exclude-requires"],
      q: args.q,
      limit: args.limit != null ? Number(args.limit) : 20,
      sort: args.sort,
    };
    const res = await client.listBounties(filters);
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`=== MCP list_bounties (${res.count ?? res.items?.length ?? 0} results) ===\n`);
      console.log(formatTable(res.items));
    }
  } else if (cmd === "new") {
    const since = args.since || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await client.getAllNewBountiesSince(since, {
      source: args.source,
      min_usd: args["min-usd"] != null ? Number(args["min-usd"]) : undefined,
      network: args.network,
      exclude_requires: args["exclude-requires"],
      q: args.q,
      limit: args.limit != null ? Number(args.limit) : 50,
    });
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`=== MCP get_new_bounties since ${since} (${res.count} items, next_since: ${res.next_since}) ===\n`);
      console.log(formatTable(res.items));
    }
  } else if (cmd === "get") {
    const id = args._[1] || args.id;
    if (!id) {
      console.error("Usage: node abf.mjs get <bounty-id> [--json]");
      process.exit(1);
    }
    const res = await client.getBounty(id);
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === "stats") {
    const res = await client.getFeedStats();
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === "tools") {
    const res = await client.listMcpTools();
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === "x402") {
    const res = await client.queryX402Bounties(
      {
        source: args.source,
        min_usd: args["min-usd"],
        network: args.network,
        no_bond: args["no-bond"],
        exclude_requires: args["exclude-requires"],
        limit: args.limit || 5,
      },
      {
        paymentHeader: args.payment || process.env.X402_PAYMENT_HEADER,
        paymentVersion: args["v2"] ? 2 : 1,
      }
    );
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`Agent Bounty Feed CLI & SDK (Zero-Dependency Node.js 18+)

Usage:
  node abf.mjs earn-now [--json]
  node abf.mjs list [--min-usd 5] [--network base] [--source taskmarket,algora,direct] [--exclude-requires kyc,stake,bond] [--sort reward|first_seen] [--limit 20] [--json]
  node abf.mjs new [--since 2026-10-28T00:00:00Z] [--exclude-requires kyc,stake] [--json]
  node abf.mjs get <bounty-id>
  node abf.mjs stats
  node abf.mjs tools
  node abf.mjs x402 [--min-usd 5] [--exclude-requires kyc,stake,bond] [--payment <X-PAYMENT-BASE64>] [--v2]
`);
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("abf.mjs")) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
