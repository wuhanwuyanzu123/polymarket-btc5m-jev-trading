/** Paired test: run the backtest entry rule on EXACTLY the windows the dry-run
 *  actually traded, then compare entry price and win rate side by side. */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "../src/loadEnv.js";
import { takerFeePerShare } from "../src/policy.js";
import { klines, twapFairUp, sigmaPerSecBefore, rangeAverager } from "./lib/history.js";

loadDotEnv();
const cachePath = resolve("data/backtest-cache.json");
const halfSpread = 0.01, feeRate = 0.07, theta = 0.1;

// dry-run's settled trades -> window ts + real entry
const recs = readFileSync("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/data/pnl.jsonl", "utf8")
  .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const dry = recs.map(r => ({
  ts: Number(String(r.slug).split("-").pop()),
  price: Number(r.entryPrice),
  win: Number(r.pnlUsd) > 0,
  size: Number(r.size),
})).filter(x => Number.isFinite(x.ts) && Number.isFinite(x.price));

const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const tsList = dry.map(d => d.ts);
const start = Math.min(...tsList) - 3600, end = Math.max(...tsList) + 3600;

const [sec, min] = await Promise.all([klines("1s", start, end), klines("1m", start - 3600, end)]);
const avg = rangeAverager(sec, start, end);

type E = { price: number; win: boolean; side: string };
const bt: E[] = [];

for (const d of dry) {
  const w = cache[String(d.ts)];
  if (!w || !Array.isArray(w.upPath) || !w.upPath.length) continue;
  const s0 = avg(d.ts - 60, d.ts);
  if (!s0 || !Number.isFinite(s0)) continue;
  const sigma = sigmaPerSecBefore(min, d.ts);
  if (sigma == null) continue;
  let taken: E | null = null;
  for (const h of w.upPath) {
    const st = sec.get(h.t);
    const tau = d.ts + 300 - h.t;
    if (!st || tau < 90 || taken) continue;
    const model = twapFairUp({ st, k: s0, sigmaPerSec: sigma, tau, partial: tau < 60 ? avg(d.ts + 240, h.t + 1) : null });
    for (const side of ["UP", "DOWN"] as const) {
      const ask = (side === "UP" ? h.p : 1 - h.p) + halfSpread;
      const p = side === "UP" ? model : 1 - model;
      if (ask <= 0 || ask >= 1) continue;
      if (p - ask - takerFeePerShare(ask, feeRate) < theta) continue;
      taken = { price: ask, win: w.winner === side, side };
      break;
    }
  }
  bt.push(taken ?? { price: NaN, win: false, side: "" }); // NaN = backtest would NOT have entered
}

const bucket = (p: number) => p < 0.2 ? "0.10-0.20" : p < 0.3 ? "0.20-0.30" : p < 0.4 ? "0.30-0.40" : p < 0.5 ? "0.40-0.50" : "0.50+";
const keys = ["0.10-0.20", "0.20-0.30", "0.30-0.40", "0.40-0.50", "0.50+"];

function dist(items: { price: number; win: boolean; side?: string }[], label: string) {
  const valid = items.filter(x => Number.isFinite(x.price));
  console.log(`\n${label}  (共 ${items.length} 笔, 回测会入场 ${valid.length} 笔)`);
  const g = new Map<string, { n: number; w: number }>();
  for (const x of valid) { const k = bucket(x.price); const r = g.get(k) ?? { n: 0, w: 0 }; r.n++; if (x.win) r.w++; g.set(k, r); }
  console.log("分组       笔数   占比    胜率");
  for (const k of keys) {
    const r = g.get(k);
    if (!r) continue;
    console.log(`${k.padEnd(10)} ${String(r.n).padStart(4)}  ${((r.n / valid.length) * 100).toFixed(1).padStart(5)}%  ${(r.w / r.n * 100).toFixed(0).padStart(4)}%`);
  }
  const win = valid.filter(x => x.win).length;
  const avgP = valid.reduce((s, x) => s + x.price, 0) / Math.max(1, valid.length);
  const ev = valid.reduce((s, x) => s + ((x.win ? 1 : 0) - x.price - takerFeePerShare(x.price, feeRate)), 0);
  console.log(`全部       ${String(valid.length).padStart(4)}  100.0%  ${(win / Math.max(1, valid.length) * 100).toFixed(0).padStart(4)}%  平均买价 ${avgP.toFixed(3)}  净 ${ev.toFixed(2)}`);
}

console.log(`=== 同一批窗口 (${dry.length} 个) 逐窗口对比 ===`);
dist(dry.map(d => ({ price: d.price, win: d.win })), "[A] dry-run 实际成交");
dist(bt, "[B] 回测规则在同样本上的入场");

const bEnter = bt.filter(x => Number.isFinite(x.price)).length;
console.log(`\n回测会入场 ${bEnter}/${dry.length} 笔, dry-run 实际 ${dry.length} 笔`);
// how often would the two pick the same price bucket?
let same = 0, cmp = 0;
for (let i = 0; i < dry.length; i++) {
  const b = bt[i];
  if (!b || !Number.isFinite(b.price)) continue;
  cmp++;
  if (bucket(b.price) === bucket(dry[i].price)) same++;
}
console.log(`在回测也入场的 ${cmp} 笔里,两者落入同一价格分组: ${same} 笔 (${(same / Math.max(1, cmp) * 100).toFixed(0)}%)`);

// direction agreement
let opp=0,agree=0,skip=0;
const rows=[];
for (let i=0;i<dry.length;i++){
  const b=bt[i]; if(!b || !Number.isFinite(b.price)) {skip++;continue;}
  rows.push({d:dry[i],b});
}
console.log(`
=== 方向一致性 ===`);
console.log(`回测可入场 ${rows.length} 笔`);
// price bucket mirror test: if same side, buckets tend to be similar; mirror = opposite
for (const r of rows){
  const db=r.d.price, bb=r.b.price;
  const mirror = Math.abs(db - (1-bb)) < 0.12;   // dry price ~ 1 - backtest price => opposite side
  const sameSide = Math.abs(db - bb) < 0.12;
  if (mirror) opp++; else if (sameSide) agree++;
}
console.log(`  同方向(价格接近): ${agree}`);
console.log(`  相反方向(价格互补 1-x): ${opp}`);
console.log(`  其他: ${rows.length-agree-opp}`);
