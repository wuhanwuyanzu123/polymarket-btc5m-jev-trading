import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, formatUnits, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { production } from '@polymarket/client';

const env = readFileSync(new URL('../.env.live', import.meta.url), 'utf8');
const value = /^WALLET_PVK\s*=\s*(\S+)/m.exec(env)?.[1];
if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('私钥格式无效');
const key = value as `0x${string}`;
const signer = privateKeyToAccount(key);
const chain = createPublicClient({ chain: polygon, transport: http('https://polygon-bor-rpc.publicnode.com', { timeout: 15000, retryCount: 1 }) });
const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)']);
const tokens = [
  { label: 'SDK当前交易抵押币', address: production.contracts.collateralToken },
  { label: '原生USDC', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' },
  { label: 'USDC.e', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174' },
];
const wallets = [
  { role: '私钥签名地址', address: signer.address },
  { role: '前次机器人资金钱包', address: '0xe856c51bd1ef2673e7be7f6a7d17b6a5b96e19ce' },
  { role: '更正后的收款地址', address: '0x7e47227766166539d9cd6762333e584ca45cd565' },
];
const report: any = { checkedAt: new Date().toISOString(), keyMasked: `${key.slice(0, 10)}…${key.slice(-4)}`, signer: signer.address, currentCollateral: production.contracts.collateralToken, wallets: [] };
for (const wallet of wallets) {
  if (!isAddress(wallet.address)) throw new Error(`无效地址: ${wallet.role}`);
  const entry: any = { ...wallet, balances: [] };
  for (const token of tokens) {
    try {
      const address = token.address as `0x${string}`;
      const [raw, decimals, symbol] = await Promise.all([
        chain.readContract({ address, abi, functionName: 'balanceOf', args: [wallet.address as `0x${string}`] }),
        chain.readContract({ address, abi, functionName: 'decimals' }),
        chain.readContract({ address, abi, functionName: 'symbol' }),
      ]);
      entry.balances.push({ ...token, symbol, decimals, amount: formatUnits(raw, decimals) });
    } catch {
      entry.balances.push({ ...token, error: 'RPC查询失败，不视为零余额' });
    }
  }
  report.wallets.push(entry);
  console.log(JSON.stringify(entry));
}
console.log(`签名地址=${signer.address}，私钥仅显示 ${report.keyMasked}`);
writeFileSync('F:/claudeprogram/polymarket-reports/wallet-readonly-check.json', JSON.stringify(report, null, 2));
