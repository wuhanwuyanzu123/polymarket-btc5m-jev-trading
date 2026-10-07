/** At each dry-run ENTER, compare the REAL live ask (logged) with the price
 *  the backtest would read from CLOB prices-history at the same instant. */
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const PROXY = "http://127.0.0.1:7897";

const raw = await readFile("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/dryrun-24h.log", "utf8");
const lines = raw.split(/\r?\n/);
// offset: log clock is UTC-8 (05:51 line vs 13:51 local) -> derive from mtime vs last line
const last = [...lines].reverse().find(s => /^\d\d:\d\d:\d\d \|/.test(s));
const localSec = (() => {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
})();
const hh = +(last || "00:00:00").slice(0, 2), mm = +(last || "00:00:00").slice(3, 5), ss = +(last || "00:00:00").slice(6, 8);
const clockSec = hh * 3600 + mm * 60 + ss;
const off = localSec - clockSec; // local - log clock, in seconds

type E = { clock: string; slug: number; side: string; ask: number; model: number };
const ent: E[] = [];
for (const s of lines) {
  const m = /^(\d\d):(\d\d):(\d\d) \| btc-updown-5m-(\d+) \|.*? ENTER (UP|DOWN): P=([\d.]+) vs ask ([\d.]+)/.exec(s);
  if (m) ent.push({ clock: `${m[1]}:${m[2]}:${m[3]}`, slug: +m[4], side: m[5], model: +m[6], ask: +m[7] });
}
console.error(`ENTER records: ${ent.length}`);

async function get(url: string): Promise<any> {
  const { stdout } = await run("curl", ["-s", "-m", "30", "-x", PROXY, url]);
  return JSON.parse(stdout);
}

const rows: any[] = [];
for (const e of ent.slice(-40)) {
  const [H, M, S] = e.clock.split(":").map(Number);
  const sod = H * 3600 + M * 60 + S;            // log clock == UTC
  const t = e.slug + (sod - (e.slug % 86400));   // unix instant of that log line
  try {
    const ev = await get(`https://gamma-api.polymarket.com/events?slug=btc-updown-5m-${e.slug}`);
    const mk = ev?.[0]?.markets?.[0];
    if (!mk) continue;
    const oc: string[] = JSON.parse(mk.outcomes), tk: string[] = JSON.parse(mk.clobTokenIds);
    const idx = e.side === "UP" ? oc.findIndex(o => /up/i.test(o)) : oc.findIndex(o => /down/i.test(o));
    const hp = await get(`https://clob.polymarket.com/prices-history?market=${tk[idx]}&startTs=${e.slug}&endTs=${e.slug + 300}&fidelity=1`);
    const hist: { t: number; p: number }[] = hp?.history ?? [];
    if (!hist.length) continue;
    const b = hist.reduce((a, x) => Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a, hist[0]);
    const btPrice = b.p + 0.01; // backtest's ask
    rows.push({ clock: e.clock, side: e.side, realAsk: e.ask, btPrice, dt: Math.abs(b.t - t) });
  } catch { /* skip */ }
}

const out: string[] = [];
out.push("时刻      方向   真实卖一价  回测假设价   差      价格源时间差");
for (const r of rows) out.push(`${r.clock}  ${r.side.padEnd(4)} ${r.realAsk.toFixed(3)}       ${r.btPrice.toFixed(3)}       ${(r.realAsk - r.btPrice >= 0 ? "+" : "") + (r.realAsk - r.btPrice).toFixed(3)}   ${r.dt}s`);
if (rows.length) {
  const d = rows.map(r => r.realAsk - r.btPrice);
  const avg = d.reduce((s, x) => s + x, 0) / d.length;
  const absAvg = d.reduce((s, x) => s + Math.abs(x), 0) / d.length;
  out.push("");
  out.push(`样本 ${rows.length} 笔`);
  out.push(`平均差 (真实-回测): ${avg.toFixed(4)}`);
  out.push(`平均绝对差: ${absAvg.toFixed(4)}`);
  out.push(`|差|>0.05 的比例: ${(d.filter(x => Math.abs(x) > 0.05).length / d.length * 100).toFixed(0)}%`);
  out.push(`|差|>0.10 的比例: ${(d.filter(x => Math.abs(x) > 0.10).length / d.length * 100).toFixed(0)}%`);
}
await writeFile("F:/claudeprogram/pricediff.txt", out.join("\n"), "utf8");
console.log("rows", rows.length);
