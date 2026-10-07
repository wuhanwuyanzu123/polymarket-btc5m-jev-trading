import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
const run = promisify(execFile);

/** Derive the signer address at runtime so no key is ever stored in the repo. */
function loadKey(): `0x${string}` {
  const fromEnv = process.env.WALLET_PVK?.trim();
  const raw =
    fromEnv || readFileSync(".env.live", "utf8").match(/^WALLET_PVK=(\S+)/m)?.[1];
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw ?? "")) {
    throw new Error("WALLET_PVK not set and no valid key in .env.live");
  }
  return raw as `0x${string}`;
}

const signer = privateKeyToAccount(loadKey()).address;

const addrs = [
  ["signer (from key)", signer],
  ["funder / Polymarket money wallet", "0xe856c51bd1ef2673e7be7f6a7d17b6a5b96e19ce"],
  ["deposit receive address", "0x7e47227766166539d9cd6762333e584ca45cd565"],
] as const;

async function get(url: string): Promise<any> {
  try {
    const { stdout } = await run("curl", ["-s", "-m", "25", "-x", "http://127.0.0.1:7897", url]);
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

console.log("=== 账户报告（只读查询）===");
for (const [label, a] of addrs) {
  const v = await get(`https://data-api.polymarket.com/value?user=${a}`);
  const val = Array.isArray(v) && v[0] ? v[0].value : "err";
  const trades = await get(`https://data-api.polymarket.com/trades?user=${a}&limit=1`);
  const tc = Array.isArray(trades) ? trades.length : "err";
  console.log(`  ${label}: ${a}`);
  console.log(`    账户价值=${val}  最近成交=${tc}条`);
}

console.log("\n=== 说明 ===");
console.log("  `/value` 只统计持仓市值，不含现金；现金余额不能用它判断。");
console.log("  当前交易抵押币是 pUSD (0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB)，");
console.log("  不是 USDC / USDC.e —— 只查那两个会把有钱的账户误判成空账户。");
console.log("  权威余额请用 scripts/check-clob-readonly.ts（走 CLOB getBalanceAllowance）。");
