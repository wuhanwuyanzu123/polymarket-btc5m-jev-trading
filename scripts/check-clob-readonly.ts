import { readFileSync, writeFileSync } from 'node:fs';
import { createWalletClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { ClobClient, Chain, AssetType, SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { production } from '@polymarket/client';
import axios from 'axios';

axios.defaults.timeout = 15000;
const env = readFileSync(new URL('../.env.live', import.meta.url), 'utf8');
const key = /^WALLET_PVK\s*=\s*(0x[0-9a-fA-F]{64})/m.exec(env)?.[1] as `0x${string}` | undefined;
if (!key) throw new Error('私钥格式无效');
const account = privateKeyToAccount(key);
const funder = '0xe856c51bd1ef2673e7be7f6a7d17b6a5b96e19ce' as const;
// SDK 内部纯函数：只做确定性地址推导，不认证、不部署钱包。
const sdkInternal = await import(new URL('../node_modules/@polymarket/client/dist/chunk-LGU5PMHE.js', import.meta.url).href);
const identity = sdkInternal.L(production, account.address, funder);
if (identity.signerType !== 'OWNER') throw new Error('资金钱包不匹配私钥推导结果');
console.log('SDK钱包映射核验：', JSON.stringify(identity));

const reportPath = 'F:/claudeprogram/polymarket-reports/wallet-readonly-check.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
report.identity = identity;
const wallet = createWalletClient({ account, chain: polygon, transport: http('https://polygon-bor-rpc.publicnode.com', { timeout: 15000 }) });
try {
  const auth = new ClobClient({ host: 'https://clob.polymarket.com', chain: Chain.POLYGON, signer: wallet, throwOnError: true });
  // 只 GET 推导已有凭据，不调用 createApiKey 或 createOrDeriveApiKey。
  const credentials = await auth.deriveApiKey();
  if (!credentials.key || !credentials.secret || !credentials.passphrase) throw new Error('已有API凭据未取回');
  const client = new ClobClient({ host: 'https://clob.polymarket.com', chain: Chain.POLYGON, signer: wallet, creds: credentials, signatureType: SignatureTypeV2.POLY_1271, funderAddress: funder, throwOnError: true });
  const balance = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  report.clob = { checkedAt: new Date().toISOString(), signatureType: 3, balanceRaw: balance.balance, balanceUsd: formatUnits(BigInt(balance.balance), 6), allowances: balance.allowances };
  console.log('CLOB可用交易余额：', JSON.stringify(report.clob));
} catch (error: any) {
  report.clob = { checkedAt: new Date().toISOString(), error: 'CLOB只读余额查询失败，不等于余额为零', status: error?.status ?? error?.response?.status ?? null };
  console.log(JSON.stringify(report.clob));
  process.exitCode = 1;
}
writeFileSync(reportPath, JSON.stringify(report, null, 2));
