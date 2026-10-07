/**
 * Headless LIVE runner — same loop as dryrun-headless but permitted to post
 * real FOK orders. Refuses to start unless LIVE_TRADING=1 and WALLET_PVK is set.
 *
 * Usage: tsx scripts/live-headless.ts [seconds]   (default 86400)
 */
import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/loadEnv.js";
import { WindowSession } from "../src/session.js";

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig(process.env);
  if (!cfg.liveTrading) {
    throw new Error("LIVE_TRADING=1 is required for live-headless (use dryrun-headless otherwise)");
  }
  if (!process.env.WALLET_PVK?.trim()) throw new Error("WALLET_PVK is required");
  if ((process.env.POLYMARKET_SOURCE ?? "auto").toLowerCase() === "fixture") {
    throw new Error("POLYMARKET_SOURCE=fixture refused in live mode (fake token ids)");
  }
  if ((process.env.POLYMARKET_SOURCE ?? "auto").toLowerCase() === "auto") {
    console.warn("[live] warning: POLYMARKET_SOURCE=auto — set it to `live` explicitly");
  }

  const seconds = Number(process.argv[2] ?? 86400);
  const until = Date.now() + seconds * 1000;
  console.log(
    `[live] starting · BET_USD=${cfg.betUsd} · MIN_EDGE=${cfg.minEdge} · ` +
    `tick=${cfg.tickMs}ms · runs for ${Math.round(seconds / 60)}min`,
  );

  const session = await WindowSession.open(cfg);
  let trades = 0;
  let lastPnl = 0;
  while (Date.now() < until) {
    const s = await session.tick();
    lastPnl = s.cumulativePnLUsd;
    const op = s.opinion
      ? `judge=${s.opinion.side}@${s.opinion.confidence.toFixed(2)}`
      : "judge=-";
    const last = s.decisionLog.at(-1);
    const isEnter = !!last?.summary?.includes("ENTER");
    if (isEnter) trades++;
    console.log(
      [s.at.slice(11, 19), s.market?.slug ?? "-", `${s.secondsRemaining ?? "?"}s`,
       s.btc ? `btc=${s.btc.last}` : "btc=-", op,
       `pos=${s.position.kind === "open" ? `${s.position.side}x${s.position.size}@${s.position.entryPrice}` : "flat"}`,
       last?.summary ?? "", `pnl=${s.cumulativePnLUsd}`, `trades=${trades}`].join(" | "),
    );
    await new Promise((r) => setTimeout(r, cfg.tickMs));
  }
  await session.close();
  console.log(`[live] stopped · total enters=${trades} · cumulative pnl=${lastPnl}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});