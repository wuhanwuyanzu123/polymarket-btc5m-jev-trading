import { privateKey } from "@polymarket/client/viem";
import { createSecureClient } from "@polymarket/client";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const env = readFileSync("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/.env.live", "utf8");
const key = (/WALLET_PVK=(\S+)/.exec(env)?.[1] ?? "") as `0x${string}`;

const signer = privateKeyToAccount(key);
console.log("SIGNER   " + signer.address);
try {
  const secure = await createSecureClient({ signer: privateKey(key) });
  console.log("FUNDER   " + secure.account.wallet);
} catch (e) {
  console.log("funder derive failed: " + (e as Error).message);
}
