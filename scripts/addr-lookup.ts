import { privateKeyToAccount } from "viem/accounts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
const run = promisify(execFile);

/** Read the key at runtime so this script never stores it in the repo. */
function loadKey(): `0x${string}` {
  const fromEnv = process.env.WALLET_PVK?.trim();
  const raw = fromEnv || readFileSync(".env.live", "utf8").match(/^WALLET_PVK=(\S+)/m)?.[1];
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw ?? "")) {
    throw new Error("WALLET_PVK not set and no valid key in .env.live");
  }
  return raw as `0x${string}`;
}

const acct = privateKeyToAccount(loadKey());
console.log("address=" + acct.address);
const A = acct.address.toLowerCase().slice(2);

async function rpcCall(rpc: string, body: unknown): Promise<any> {
  const { stdout } = await run("curl", ["-s", "-m", "15", "-x", "http://127.0.0.1:7897",
    "-H", "Content-Type: application/json", "-d", JSON.stringify(body), rpc]);
  const j = JSON.parse(stdout);
  return j.result;
}
async function erc20(rpc: string, tok: string): Promise<number | null> {
  try {
    const r = await rpcCall(rpc, { jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: tok, data: "0x70a08231000000000000000000000000" + A }, "latest"] });
    return r ? Number(BigInt(r)) / 1e6 : null;
  } catch { return null; }
}
async function native(rpc: string): Promise<number | null> {
  try {
    const r = await rpcCall(rpc, { jsonrpc: "2.0", id: 1, method: "eth_getBalance",
      params: ["0x" + A, "latest"] });
    return r ? Number(BigInt(r)) / 1e18 : null;
  } catch { return null; }
}

const chains: [string, string, string | null][] = [
  ["Polygon", "https://polygon-bor-rpc.publicnode.com", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"],
  ["Polygon2 USDC","https://polygon-bor-rpc.publicnode.com","0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"],
  ["Base", "https://mainnet.base.org", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  ["Arbitrum", "https://arb1.arbitrum.io/rpc", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
  ["Optimism", "https://mainnet.optimism.io", "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"],
];
console.log(chains.map(c => c[0]).join("\t"));
for (const [name, rpc, tok] of chains) {
  const u = tok ? await erc20(rpc, tok) : null;
  const n = await native(rpc);
  console.log(`${name}: USDC=${u !== null ? "$" + u.toFixed(4) : "err"}  native=${n !== null ? n.toFixed(6) : "err"}`);
}
