import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
const env = readFileSync("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/.env.live", "utf8");
const key = /WALLET_PVK=(\S+)/.exec(env)?.[1] ?? "";
if (!key) { console.log("no key"); process.exit(1); }
const acct = privateKeyToAccount(key as `0x${string}`);
console.log("SIGNER=" + acct.address);
