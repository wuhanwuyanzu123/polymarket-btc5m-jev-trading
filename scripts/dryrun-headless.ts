import { loadConfig } from "../src/config.js";
import { loadDotEnv } from "../src/loadEnv.js";
import { WindowSession } from "../src/session.js";

// Headless dry-run loop: one compact line per tick. Usage: tsx scripts/dryrun-headless.ts [seconds]
async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig(process.env);
  if (cfg.liveTrading) throw new Error("dryrun-headless refuses LIVE_TRADING=1");
  const until = Date.now() + Number(process.argv[2] ?? 360) * 1000;
  const session = await WindowSession.open(cfg);
  while (Date.now() < until) {
    const s = await session.tick();
    const op = s.opinion
      ? `judge=${s.opinion.side}@${s.opinion.confidence.toFixed(2)} P(UP)=${s.opinion.probs?.UP.toFixed(2) ?? "?"}`
      : "judge=-";
    const btc = s.btc ? `btc=${s.btc.last} (${s.btc.source})` : "btc=-";
    // Real book quotes for the side the judge picked — the backtest assumes
    // ask = mid + spread; this records what the book actually charges so the
    // assumption can be checked against reality.
    let q = "q=-";
    if (s.opinion && s.market) {
      const up = s.opinion.side === "UP";
      const bid = up ? s.market.upBid : s.market.downBid;
      const ask = up ? s.market.upAsk : s.market.downAsk;
      const mid = up ? s.market.upMid : s.market.downMid;
      const gap = ask != null && mid != null ? ask - mid : null;
      q = `q=${s.opinion.side} bid=${bid ?? "-"} ask=${ask ?? "-"} mid=${mid ?? "-"} ask-mid=${gap != null ? gap.toFixed(4) : "-"}`;
    }
    const last = s.decisionLog.at(-1);
    console.log(
      [s.at.slice(11, 19), s.market?.slug ?? "-", `${s.secondsRemaining ?? "?"}s`, btc, op, q,
       `pos=${s.position.kind === "open" ? `${s.position.side}x${s.position.size}@${s.position.entryPrice}` : "flat"}`,
       last?.summary ?? "", `pnl=${s.cumulativePnLUsd}`].join(" | "),
    );
    await new Promise((r) => setTimeout(r, cfg.tickMs));
  }
  await session.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
