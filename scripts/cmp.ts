/** Actual FOK fills vs the price a backtest-style history read would assume. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const PROXY = "http://127.0.0.1:7897";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

// btc-updown-5m-1791259200 began 04:00:00 local (log showed 04:01:44 with 195s left)
const W0 = 1791259200;
const L0 = 4 * 3600;
const fills = [
  { slug: 1791258900, clock: "03:57:54", side: "UP" as const, fill: 0.33 },
  { slug: 1791259500, clock: "04:06:24", side: "DOWN" as const, fill: 0.25 },
  { slug: 1791259800, clock: "04:12:57", side: "DOWN" as const, fill: 0.24 },
];

async function get(url: string): Promise<any> {
  const { stdout } = await run("curl", ["-s", "-m", "30", "-x", PROXY, url]);
  return JSON.parse(stdout);
}

const rows: any[] = [];
for (const f of fills) {
  const [h, m, s] = f.clock.split(":").map(Number);
  const sod = h * 3600 + m * 60 + s;
  const localAtSlug = L0 - (W0 - f.slug);       // local seconds-of-day at window start
  const t = f.slug + (sod - localAtSlug);
  const ev = await get(`${GAMMA}/events?slug=btc-updown-5m-${f.slug}`);
  const mk = ev?.[0]?.markets?.[0];
  if (!mk) continue;
  const outcomes: string[] = JSON.parse(mk.outcomes);
  const tokens: string[] = JSON.parse(mk.clobTokenIds);
  const iUp = outcomes.findIndex(o => /up/i.test(o));
  const hp = await get(`${CLOB}/prices-history?market=${tokens[iUp]}&startTs=${f.slug}&endTs=${f.slug + 300}&fidelity=1`);
  const hist: { t: number; p: number }[] = hp?.history ?? [];
  if (!hist.length) continue;
  let best = hist[0];
  for (const x of hist) if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
  const upAtPoint = best.p;
  const btPrice = f.side === "UP" ? upAtPoint : 1 - upAtPoint;
  const delta = f.fill - btPrice;
  rows.push({ slug: f.slug, clock: f.clock, side: f.side, bt: btPrice, fill: f.fill, delta, pct: delta / btPrice * 100, when: new Date(best.t * 1000).toISOString() });
}

console.log("窗口          下单时刻  方向  回测假设价  实际成交  差价    相对差");
for (const r of rows) {
  console.log(
    `${r.slug}  ${r.clock}  ${r.side.padEnd(4)}  ` +
    `${r.bt.toFixed(3).padStart(8)}    ${r.fill.toFixed(3)}   ` +
    `${(r.delta >= 0 ? "+" : "") + r.delta.toFixed(3).padStart(5)}  ` +
    `${(r.pct >= 0 ? "+" : "") + r.pct.toFixed(1).padStart(6)}%`
  );
}
if (rows.length) {
  const avg = rows.reduce((s, r) => s + r.delta, 0) / rows.length;
  const avgP = rows.reduce((s, r) => s + r.pct, 0) / rows.length;
  console.log(`\n平均: 实际成交比回测假设价 ${avg >= 0 ? "贵" : "便宜"} ${Math.abs(avg).toFixed(4)} (${avgP >= 0 ? "+" : ""}${avgP.toFixed(1)}%)`);
  console.log(`按每份 $1 计,3 笔多付/少付 ${Math.abs(rows.reduce((s, r) => s + r.delta, 0)).toFixed(4)}`);
}
