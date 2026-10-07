import { privateKeyToAccount } from "viem/accounts";
import { privateKey } from "@polymarket/client/viem";
import { createSecureClient } from "@polymarket/client";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const key = /WALLET_PVK=(\S+)/.exec(
  readFileSync("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/.env.live", "utf8"),
)![1]! as `0x${string}`;

const acct = privateKeyToAccount(key);
console.log("signer  :", acct.address);
try {
  const s = await createSecureClient({ signer: privateKey(key) });
  console.log("funder  :", s.account.wallet);
} catch (e) {
  console.log("funder  : 推导失败 —", (e as Error).message.slice(0, 90));
}

const RPC = "https://polygon-bor-rpc.publicnode.com";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

async function rpc(body: unknown): Promise<any> {
  const { stdout } = await run("curl", ["-s", "-m", "20", "-x", "http://127.0.0.1:7897",
    "-H", "Content-Type: application/json", "-d", JSON.stringify(body), RPC]);
  return JSON.parse(stdout);
}
async function bal(a: string, tok: string): Promise<number | null> {
  try {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: tok, data: "0x70a08231000000000000000000000000" + a.slice(2) }, "latest"] });
    return Number(BigInt(r.result)) / 1e6;
  } catch { return null; }
}
async function matic(a: string): Promise<number | null> {
  try {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [a, "latest"] });
    return Number(BigInt(r.result)) / 1e18;
  } catch { return null; }
}

const cands = [
  ["signer", acct.address],
  ["funder", "0xe856c51bd1ef2673e7be7f6a7d17b6a5b96e19ce"],
  ["other", "0xd81052f7fe0fe7a8ef073c2a87bc94da0b2b7968"],
];
console.log("\n地址            USDC.e      USDC        MATIC");
for (const [name, a] of cands) {
  const [ue, u, m] = await Promise.all([bal(a!, USDC_E), bal(a!, USDC), matic(a!)]);
  console.log(
    `${name.padEnd(8)} ${a}` +
    `\n  USDC.e=${ue?.toFixed(4) ?? "err"}  USDC=${u?.toFixed(4) ?? "err"}  MATIC=${m?.toFixed(4) ?? "err"}`,
  );
}
