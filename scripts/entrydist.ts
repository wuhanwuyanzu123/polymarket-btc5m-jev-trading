/** Record the ENTRY PRICE distribution of the backtest taker sim, bucketed,
 *  so it can be compared against the dry-run's actual entry prices. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "../src/loadEnv.js";
import { takerFeePerShare } from "../src/policy.js";
import { arg, klines, twapFairUp, sigmaPerSecBefore, rangeAverager, pct } from "./lib/history.js";

loadDotEnv();
const CLOB = "https://clob.polymarket.com";
const days = arg("--days", 7);
const halfSpread = arg("--spread", 0.01);
const feeRate = arg("--fee-rate", 0.07);
const theta = arg("--theta", 0.1);
const cachePath = resolve("data/backtest-cache.json");

type W = { ts: number; winner: "UP" | "DOWN"; upPath: { t: number; p: number }[] };

const end = Math.floor(Date.now() / 1000 / 300) * 300 - 600;
const start = end - Math.round((days * 86400) / 300) * 300;
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const ws: W[] = [];
for (let ts = start; ts < end; ts += 300) {
  const w = cache[ts];
  if (w && Array.isArray(w.upPath) && w.upPath.length) ws.push(w as W);
}
console.error(`cached windows: ${ws.length}`);

const [sec, min] = await Promise.all([
  klines("1s", start - 120, end + 300),
  klines("1m", start - 3600, end + 300),
]);
const avg = rangeAverager(sec, start - 120, end + 300);

type E = { price: number; win: boolean; tau: number; side: string };
const entries: E[] = [];

for (const w of ws) {
  const s0 = avg(w.ts - 60, w.ts);
  if (!s0 || !Number.isFinite(s0)) continue;
  const sigma = sigmaPerSecBefore(min, w.ts);
  if (sigma == null) continue;
  let taken: E | null = null;
  for (const h of w.upPath) {
    const st = sec.get(h.t);
    const tau = w.ts + 300 - h.t;
    if (!st || tau < 90 || taken) continue;
    const model = twapFairUp({ st, k: s0, sigmaPerSec: sigma, tau, partial: tau < 60 ? avg(w.ts + 240, h.t + 1) : null });
    for (const side of ["UP", "DOWN"] as const) {
      const ask = (side === "UP" ? h.p : 1 - h.p) + halfSpread;
      const p = side === "UP" ? model : 1 - model;
      if (ask <= 0 || ask >= 1) continue;
      const fee = takerFeePerShare(ask, feeRate);
      if (p - ask - fee < theta) continue;
      taken = { price: ask, win: w.winner === side, tau, side };
      break;
    }
  }
  if (taken) entries.push(taken);
}

const b = (p: number) => p < 0.2 ? "0.10-0.20" : p < 0.3 ? "0.20-0.30" : p < 0.4 ? "0.30-0.40" : p < 0.5 ? "0.40-0.50" : "0.50+";
const g = new Map<string, { n: number; w: number; sum: number; sumPnl: number }>();
for (const e of entries) {
  const k = b(e.price);
  const r = g.get(k) ?? { n: 0, w: 0, sum: 0, sumPnl: 0 };
  r.n++; if (e.win) r.w++;
  r.sum += e.price;
  r.sumPnl += (e.win ? 1 : 0) - e.price - takerFeePerShare(e.price, feeRate);
  g.set(k, r);
}
console.log(`回测入场: ${entries.length} 笔 / ${ws.length} 窗口 (θ=${theta}, spread=${halfSpread})`);
console.log("分组       笔数   占比    胜率    平均买价   每笔EV");
let tot = 0, win = 0, pnl = 0, sumP = 0;
for (const k of ["0.10-0.20", "0.20-0.30", "0.30-0.40", "0.40-0.50", "0.50+"]) {
  const r = g.get(k);
  if (!r) continue;
  tot += r.n; win += r.w; pnl += r.sumPnl; sumP += r.sum;
  console.log(`${k.padEnd(10)} ${String(r.n).padStart(4)}  ${pct(r.n / entries.length).padStart(6)}  ${pct(r.w / r.n).padStart(6)}  ${(r.sum / r.n).toFixed(3).padStart(8)}  ${((r.sumPnl / r.n) >= 0 ? "+" : "") + (r.sumPnl / r.n).toFixed(3)}`);
}
console.log(`全部       ${String(tot).padStart(4)}  ${pct(tot / entries.length).padStart(6)}  ${pct(win / tot).padStart(6)}  ${(sumP / tot).toFixed(3).padStart(8)}  ${(pnl / tot >= 0 ? "+" : "") + (pnl / tot).toFixed(3)}  (净 ${pnl.toFixed(2)})`);
console.log(`入场时刻距窗口结束: 中位 ${entries.map(e => e.tau).sort((a, b) => a - b)[Math.floor(entries.length / 2)]} 秒`);
