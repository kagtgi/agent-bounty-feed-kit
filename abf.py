#!/usr/bin/env python3
"""
Agent Bounty Feed — Zero-Dependency Python 3 Client (MCP, /earn-now & x402)
Uses only the Python standard library (urllib.request, json, base64, argparse).
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

MCP_URL = "https://agent-bounty-feed.dailydollar.workers.dev/mcp"
EARN_NOW_URL = "https://agent-bounty-feed.dailydollar.workers.dev/earn-now"
X402_URL = "https://agent-bounty-feed.dailydollar.workers.dev/v1/bounties"
FEED_URL = "https://dailydollar-bot.github.io/agent-bounty-feed/feed.json"
USER_AGENT = "AgentBountyFeedKit/1.0"


class AgentBountyFeedClient:
    def __init__(self, mcp_url=MCP_URL, earn_now_url=EARN_NOW_URL, x402_url=X402_URL):
        self.mcp_url = mcp_url
        self.earn_now_url = earn_now_url
        self.x402_url = x402_url
        self._rpc_id = 1

    def call_mcp_tool(self, name: str, arguments: dict | None = None) -> dict:
        clean_args = {
            k: v for k, v in (arguments or {}).items() if v is not None and v != ""
        }
        payload = {
            "jsonrpc": "2.0",
            "id": self._rpc_id,
            "method": "tools/call",
            "params": {"name": name, "arguments": clean_args},
        }
        self._rpc_id += 1

        req = urllib.request.Request(
            self.mcp_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "error" in data and data["error"]:
            raise RuntimeError(f"MCP RPC Error: {data['error']}")

        result = data.get("result", {})
        if result.get("isError"):
            raise RuntimeError(f"MCP Tool Error: {result}")

        for block in result.get("content", []):
            if block.get("type") == "text":
                return json.loads(block["text"])
        return result

    def list_bounties(self, **filters) -> dict:
        return self.call_mcp_tool("list_bounties", filters)

    def get_new_bounties(self, since: str, after_id: str | None = None, **filters) -> dict:
        return self.call_mcp_tool(
            "get_new_bounties", {"since": since, "after_id": after_id, **filters}
        )

    def get_all_new_bounties_since(self, since: str, **filters) -> dict:
        all_items = []
        cur_since = since
        cur_after_id = None
        while True:
            page = self.get_new_bounties(since=cur_since, after_id=cur_after_id, **filters)
            all_items.extend(page.get("items", []))
            if not page.get("has_more"):
                return {
                    "count": len(all_items),
                    "next_since": page.get("next_since"),
                    "items": all_items,
                }
            cur_since = page.get("next_since")
            cur_after_id = page.get("next_after_id")

    def get_bounty(self, bounty_id: str) -> dict:
        return self.call_mcp_tool("get_bounty", {"id": bounty_id})

    def get_feed_stats(self) -> dict:
        return self.call_mcp_tool("get_feed_stats", {})

    def get_earn_now(self) -> dict:
        req = urllib.request.Request(
            self.earn_now_url,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def query_x402_bounties(
        self, payment_header: str | None = None, v2: bool = False, **params
    ) -> dict:
        clean_params = {k: v for k, v in params.items() if v is not None and v != ""}
        query = urllib.parse.urlencode(clean_params)
        url = f"{self.x402_url}?{query}" if query else self.x402_url

        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if payment_header:
            headers["PAYMENT-SIGNATURE" if v2 else "X-PAYMENT"] = payment_header

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return {
                    "paid": True,
                    "status": resp.status,
                    "payment_response": resp.headers.get("X-PAYMENT-RESPONSE")
                    or resp.headers.get("PAYMENT-RESPONSE"),
                    "data": json.loads(resp.read().decode("utf-8")),
                }
        except urllib.error.HTTPError as e:
            if e.code == 402:
                v1_body = json.loads(e.read().decode("utf-8"))
                pay_req_b64 = e.headers.get("PAYMENT-REQUIRED")
                v2_header = None
                if pay_req_b64:
                    try:
                        v2_header = json.loads(
                            base64.b64decode(pay_req_b64).decode("utf-8")
                        )
                    except Exception:
                        v2_header = pay_req_b64
                return {
                    "paid": False,
                    "status": 402,
                    "endpoint": url,
                    "x402_v1": v1_body,
                    "x402_v2": v2_header,
                }
            raise


def format_table(items: list[dict]) -> str:
    if not items:
        return "No matching bounties found."
    rows = []
    for b in items:
        est = b.get("est_usd")
        rew = b.get("reward", est)
        cur = b.get("currency", "USD")
        reward_str = f"${est} ({rew} {cur})" if est is not None else f"{rew} {cur}"
        reqs = ",".join(b.get("requires") or []) or "none"
        rows.append(
            {
                "ID": str(b.get("id", ""))[:28],
                "Source": str(b.get("source", "")),
                "Reward": reward_str,
                "Requires": reqs,
                "Title": str(b.get("title", ""))[:44],
                "URL": str(b.get("url", "")),
            }
        )
    cols = ["ID", "Source", "Reward", "Requires", "Title", "URL"]
    widths = {c: max(len(c), *(len(r[c]) for r in rows)) for c in cols}
    header = " | ".join(c.ljust(widths[c]) for c in cols)
    sep = "-+-".join("-" * widths[c] for c in cols)
    body = "\n".join(" | ".join(r[c].ljust(widths[c]) for c in cols) for r in rows)
    return f"{header}\n{sep}\n{body}"


def main():
    parser = argparse.ArgumentParser(description="Agent Bounty Feed Python CLI & SDK")
    sub = parser.add_subparsers(dest="cmd")

    p_earn = sub.add_parser("earn-now", help="Fetch /earn-now instant bounties")
    p_earn.add_argument("--json", action="store_true")

    p_list = sub.add_parser("list", help="Call MCP list_bounties")
    p_list.add_argument("--source")
    p_list.add_argument("--min-usd", type=float)
    p_list.add_argument("--network")
    p_list.add_argument("--exclude-requires")
    p_list.add_argument("--q")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--sort", choices=["reward", "first_seen"])
    p_list.add_argument("--json", action="store_true")

    p_new = sub.add_parser("new", help="Call MCP get_new_bounties with cursor pagination")
    p_new.add_argument("--since")
    p_new.add_argument("--source")
    p_new.add_argument("--min-usd", type=float)
    p_new.add_argument("--network")
    p_new.add_argument("--exclude-requires")
    p_new.add_argument("--limit", type=int, default=50)
    p_new.add_argument("--json", action="store_true")

    p_get = sub.add_parser("get", help="Call MCP get_bounty")
    p_get.add_argument("id")

    sub.add_parser("stats", help="Call MCP get_feed_stats")

    p_x402 = sub.add_parser("x402", help="Inspect or pay x402 /v1/bounties")
    p_x402.add_argument("--source")
    p_x402.add_argument("--min-usd", type=float)
    p_x402.add_argument("--network")
    p_x402.add_argument("--no-bond", type=int, choices=[0, 1])
    p_x402.add_argument("--exclude-requires")
    p_x402.add_argument("--limit", type=int, default=5)
    p_x402.add_argument("--payment", default=os.environ.get("X402_PAYMENT_HEADER"))
    p_x402.add_argument("--v2", action="store_true")

    args = parser.parse_args()
    client = AgentBountyFeedClient()

    if args.cmd == "earn-now":
        res = client.get_earn_now()
        if args.json:
            print(json.dumps(res, indent=2))
        else:
            print(
                f"=== Agent Bounty Feed: /earn-now ({res.get('count')} instant bounties) ===\n"
            )
            print(format_table(res.get("items", [])))
    elif args.cmd == "list":
        res = client.list_bounties(
            source=args.source,
            min_usd=args.min_usd,
            network=args.network,
            exclude_requires=args.exclude_requires,
            q=args.q,
            limit=args.limit,
            sort=args.sort,
        )
        if args.json:
            print(json.dumps(res, indent=2))
        else:
            print(format_table(res.get("items", [])))
    elif args.cmd == "new":
        since = args.since or (
            datetime.now(timezone.utc) - timedelta(hours=24)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        res = client.get_all_new_bounties_since(
            since=since,
            source=args.source,
            min_usd=args.min_usd,
            network=args.network,
            exclude_requires=args.exclude_requires,
            limit=args.limit,
        )
        if args.json:
            print(json.dumps(res, indent=2))
        else:
            print(format_table(res.get("items", [])))
    elif args.cmd == "get":
        print(json.dumps(client.get_bounty(args.id), indent=2))
    elif args.cmd == "stats":
        print(json.dumps(client.get_feed_stats(), indent=2))
    elif args.cmd == "x402":
        res = client.query_x402_bounties(
            payment_header=args.payment,
            v2=args.v2,
            source=args.source,
            min_usd=args.min_usd,
            network=args.network,
            no_bond=args.no_bond,
            exclude_requires=args.exclude_requires,
            limit=args.limit,
        )
        print(json.dumps(res, indent=2))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
