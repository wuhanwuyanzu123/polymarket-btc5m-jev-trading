/**
 * Would exiting mid-window beat holding to resolution?
 *
 * Same data and entry rule as backtest-history (cached windows), but once in,
 * walk forward and optionally SELL when the model's P(this side wins) falls
 * below a threshold — selling at that moment's market price minus half-spread.
 *
 * Compares EV/share of: hold-to-resolution vs exit-at-threshold-X.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDotEnv } from "../src/loadEnv.js";
import { fetchJson } from "../src/adapters/polymarket/wire.js";
import { arg, f3, klines, pct, twapFairUp, sigmaPerSecBefore, rangeAverager } from "./lib/history.js";
import { takerFeePerShare } from "../src/policy.js";

loadDotEnv();
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const days = arg("--days", 7);
const halfSpread = arg("--spread", 0.01);
const feeRate = arg("--fee-rate", 0.07);
const theta = arg("--theta", 0.1);
const exits = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(String);
const cachePath = resolve("data/backtest-cache.json");

type Window = { ts: number; winner: "UP" | "DOWN"; upPath: { t: number; p: number }[] };

async function main() {
  const end = Math.floor(Date.now() / 1000 / 300) * 300 - 600;
  const start = end - Math.round((days * 86400) / 300) * 300;
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const windows: Window[] = [];
  for (let ts = start; ts < end; ts += 300) {
    const w = cache[ts];
    if (w && Array.isArray(w.upPath) && w.upPath.length) windows.push(w as Window);
  }
  console.error(`cached windows: ${windows.length}`);

  const [sec, min] = await Promise.all([
    klines("1s", start - 120, end + 300),
    klines("1m", start - 3600, end + 300),
  ]);
  const avg = rangeAverager(sec, start - 120, end + 300);

  // Build observations: for each window, the ordered path of (t, mkt, modelUp, sigma, s0)
  type Pt = { t: number; mkt: number; modelUp: number; tau: number };
  const byWin: Pt[][] = [];
  for (const w of windows) {
    const s0 = avg(w.ts - 60, w.ts);
    if (!s0 || !Number.isFinite(s0)) continue;
    const sigma = sigmaPerSecBefore(min, w.ts);
    if (sigma == null) continue;
    const pts: Pt[] = [];
    for (const h of w.upPath) {
      const st = sec.get(h.t);
      const tau = w.ts + 300 - h.t;
      if (!st || tau < 15) continue;
      const modelUp = twapFairUp({ st, k: s0, sigmaPerSec: sigma, tau, partial: tau < 60 ? avg(w.ts + 240, h.t + 1) : null });
      pts.push({ t: h.t, mkt: h.p, modelUp, tau });
    }
    if (pts.length) byWin.push(pts);
  }
  console.error(`windows with path: ${byWin.length}`);

  type Res = { n: number; wins: number; pnl: number };
  const hold: Res = { n: 0, wins: 0, pnl: 0 };
  const exitAt: Record<string, Res> = {};
  for (const e of exits) exitAt[e] = { n: 0, wins: 0, pnl: 0 };

  const official = (w: Window, side: "UP" | "DOWN") => w.winner === side;
  // We need the winner per window; rebuild map ts -> winner
  const winOf = new Map<number, "UP" | "DOWN">();
  for (const w of windows) winOf.set(w.ts, w.winner);

  // Walk windows in the same order the path arrays were built (they align with `windows`)
  for (let i = 0; i < windows.length; i++) {
    const pts = byWin[i];
    if (!pts) continue; // alignment: byWin only skipped some windows — recompute safely below
  }
  // Safer: recompute with explicit ts tags
  const rows: { ts: number; pts: Pt[] }[] = [];
  for (const w of windows) {
    const s0 = avg(w.ts - 60, w.ts);
    if (!s0 || !Number.isFinite(s0)) continue;
    const sigma = sigmaPerSecBefore(min, w.ts);
    if (sigma == null) continue;
    const pts: Pt[] = [];
    for (const h of w.upPath) {
      const st = sec.get(h.t);
      const tau = w.ts + 300 - h.t;
      if (!st || tau < 15) continue;
      const modelUp = twapFairUp({ st, k: s0, sigmaPerSec: sigma, tau, partial: tau < 60 ? avg(w.ts + 240, h.t + 1) : null });
      pts.push({ t: h.t, mkt: h.p, modelUp, tau });
    }
    if (pts.length) rows.push({ ts: w.ts, pts });
  }

  for (const r of rows) {
    // ENTRY: first point with tau>=90 where a side clears the edge gate
    let entry: { side: "UP" | "DOWN"; price: number; p: number; t: number } | null = null;
    for (const p of r.pts) {
      if (p.tau < 90) break;
      for (const side of ["UP", "DOWN"] as const) {
        const ask = (side === "UP" ? p.mkt : 1 - p.mkt) + halfSpread;
        const prob = side === "UP" ? p.modelUp : 1 - p.modelUp;
        if (ask <= 0 || ask >= 1) continue;
        const fee = takerFeePerShare(ask, feeRate);
        if (prob - ask - fee >= theta) { entry = { side, price: ask, p: prob, t: p.t }; break; }
      }
      if (entry) break;
    }
    if (!entry) continue;
    const win = winOf.get(r.ts);
    if (!win) continue;

    // A) hold to resolution
    hold.n++;
    const hitHold = win === entry.side;
    if (hitHold) hold.wins++;
    hold.pnl += (hitHold ? 1 : 0) - entry.price - takerFeePerShare(entry.price, feeRate);

    // B) exit when model P(this side) drops below threshold
    for (const e of exits) {
      const th = Number(e);
      const res = exitAt[e];
      let exitPrice: number | null = null;
      for (const p of r.pts) {
        if (p.t <= entry.t) continue;
        const heldP = entry.side === "UP" ? p.modelUp : 1 - p.modelUp;
        if (heldP < th) {
          const bid = (entry.side === "UP" ? p.mkt : 1 - p.mkt) - halfSpread; // sell at bid
          if (bid > 0 && bid < 1) { exitPrice = bid; break; }
        }
      }
      res.n++;
      if (exitPrice != null) {
        // sold early: gains exitPrice - entry, plus the entry fee
        res.pnl += exitPrice - entry.price - takerFeePerShare(entry.price, feeRate);
      } else {
        const hit = win === entry.side;
        if (hit) res.wins++;
        res.pnl += (hit ? 1 : 0) - entry.price - takerFeePerShare(entry.price, feeRate);
      }
    }
  }

  const fmt = (r: Res, n: number) =>
    `n=${String(r.n).padStart(4)}  $/笔 ${f3(r.pnl / Math.max(1, r.n))}  合计 ${r.pnl.toFixed(2)}  (样本占比 ${pct(r.n / n)})`;
  const total = Object.values(exitAt)[0]?.n ?? hold.n;
  console.log(`\n入场规则: θ=${theta}, spread=${halfSpread}, ≥90s, 每窗口最多 1 次`);
  console.log(`样本: ${total} 笔入场 / ${rows.length} 个窗口\n`);
  console.log(`持有到结算(现状)          ${fmt(hold, total)}`);
  console.log(`--- 持仓方模型概率跌破阈值就卖 ---`);
  for (const e of exits) console.log(`  P(held) < ${e.padEnd(4)} 卖出        ${fmt(exitAt[e], total)}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
