/** For every real fill: planned price (from log) vs actual fill price vs the
 *  backtest-style history price at that second. Writes a small table. */
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const PROXY = "http://127.0.0.1:7897";
const W0 = 1791259200, L0 = 4 * 3600;

const raw = await readFile("C:/Users/Administrator/AppData/Local/Temp/edge-analysis/live-24h.log", "utf8");
const lines = raw.split(/\r?\n/);
const start = lines.reduce((a, s, i) => (s.startsWith("# LIVE_RESTART_UTC=") ? i : a), 0);
const log = lines.slice(start + 1);

type Fill = { clock: string; slug: number; side: string; fill: number; ask: number; p: number; edge: number; size: number };
const fills: Fill[] = [];

for (let i = 0; i < log.length; i++) {
  const s = log[i].replace(/�/g, "-");
  const f = /FOK FILL (BUY) (UP|DOWN) @([\d.]+) ×([\d.]+)/.exec(s);
  if (!f) continue;
  // walk backwards to the ENTER of the same window
  let clock = "", slug = 0, ask = NaN, p = NaN, edge = NaN;
  for (let k = Math.max(0, i - 30); k < i; k++) {
    const t = log[k].replace(/�/g, "-");
    const e = /^(\d\d:\d\d:\d\d) \| btc-updown-5m-(\d+) \|.* ENTER (UP|DOWN): P=([\d.]+) vs ask ([\d.]+) .*\(edge ([\d.]+)\)/.exec(t);
    if (e && e[3] === f[2] && e[2] === String(matchSlug(s, f[2]))) { clock = e[1]; slug = +e[2]; p = +e[4]; ask = +e[5]; edge = +e[6]; }
  }
  if (!slug) {
    // fallback: nearest ENTER above
    for (let k = i - 1; k >= Math.max(0, i - 30); k--) {
      const t = log[k].replace(/�/g, "-");
      const e = /^(\d\d:\d\d:\d\d) \| btc-updown-5m-(\d+) \|.* ENTER (UP|DOWN): P=([\d.]+) vs ask ([\d.]+) .*\(edge ([\d.]+)\)/.exec(t);
      if (e && e[3] === f[2]) { clock = e[1]; slug = +e[2]; p = +e[4]; ask = +e[5]; edge = +e[6]; break; }
    }
  }
  fills.push({ clock, slug, side: f[2], fill: +f[3], size: +f[4], ask, p, edge });
}
function matchSlug(_s: string, _side: string): number { return 0; }

async function get(url: string): Promise<any> {
  const { stdout } = await run("curl", ["-s", "-m", "30", "-x", PROXY, url]);
  return JSON.parse(stdout);
}

const out: string[] = [];
out.push("下单时刻  窗口         方向  模型P   真实ask  实际成交  成交-ask  回测假设价  成交-回测");
for (const f of fills) {
  if (!f.slug) continue;
  const [h, m, s] = (f.clock || "00:00:00").split(":").map(Number);
  const localAtSlug = L0 - (W0 - f.slug);
  const t = f.slug + (h * 3600 + m * 60 + s - localAtSlug);
  let bt = NaN;
  try {
    const ev = await get(`https://gamma-api.polymarket.com/events?slug=btc-updown-5m-${f.slug}`);
    const mk = ev?.[0]?.markets?.[0];
    if (mk) {
      const oc: string[] = JSON.parse(mk.outcomes), tk: string[] = JSON.parse(mk.clobTokenIds);
      const i = oc.findIndex(o => /up/i.test(o));
      const hp = await get(`https://clob.polymarket.com/prices-history?market=${tk[i]}&startTs=${f.slug}&endTs=${f.slug + 300}&fidelity=1`);
      const hist: { t: number; p: number }[] = hp?.history ?? [];
      if (hist.length) {
        let b = hist[0]; for (const x of hist) if (Math.abs(x.t - t) < Math.abs(b.t - t)) b = x;
        bt = f.side === "UP" ? b.p : 1 - b.p;
      }
    }
  } catch { /* keep NaN */ }
  const dAsk = f.fill - f.ask;
  const dBt = f.fill - bt;
  out.push(
    `${f.clock || "?"}  ${f.slug}  ${f.side.padEnd(5)}  ${f.p.toFixed(3)}   ${f.ask.toFixed(3)}    ` +
    `${f.fill.toFixed(3)}    ${dAsk >= 0 ? "+" : ""}${dAsk.toFixed(3)}     ` +
    (Number.isFinite(bt) ? `${bt.toFixed(3)}      ${dBt >= 0 ? "+" : ""}${dBt.toFixed(3)}` : "n/a        n/a")
  );
}
const ok = fills.filter(f => Number.isFinite(f.fill) && Number.isFinite(f.ask));
if (ok.length) {
  const avgAsk = ok.reduce((s, f) => s + (f.fill - f.ask), 0) / ok.length;
  out.push("");
  out.push(`实际成交 vs 机器人看到的 ask: 平均 ${avgAsk >= 0 ? "+" : ""}${avgAsk.toFixed(4)}  (${ok.filter(f => f.fill > f.ask).length}/${ok.length} 笔成交价高于 ask)`);
}
await writeFile("F:/claudeprogram/fill-compare.txt", out.join("\n"), "utf8");
console.log("written", out.length, "rows");
