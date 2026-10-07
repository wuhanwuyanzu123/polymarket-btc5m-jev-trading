#!/bin/sh
# Start the LIVE headless runner using .env.live.
# Values exported here win over .env (loadDotEnv keeps already-set vars).
set -e
cd "$(dirname "$0")" || exit 1

# ---- load .env.live into the environment ----
while IFS= read -r line; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  key="${line%%=*}"
  val="${line#*=}"
  key=$(printf '%s' "$key" | tr -d ' \r')
  val=$(printf '%s' "$val" | sed -e 's/\r$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")
  [ -n "$key" ] || continue
  export "$key=$val"
done < .env.live

# ---- refuse to start without the key ----
if [ -z "$WALLET_PVK" ]; then
  echo "[live] ABORT: WALLET_PVK is empty in .env.live — put your private key there first." >&2
  exit 1
fi
if [ "$LIVE_TRADING" != "1" ] && [ "$LIVE_TRADING" != "true" ]; then
  echo "[live] ABORT: LIVE_TRADING must be 1 in .env.live" >&2
  exit 1
fi

# ---- Polymarket needs the local proxy; Binance is faster direct ----
export NODE_USE_ENV_PROXY=1
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export NO_PROXY="data-api.binance.vision,localhost,127.0.0.1,::1"

echo "[live] LIVE_TRADING=$LIVE_TRADING  BET_USD=$BET_USD  MIN_EDGE=$MIN_EDGE  JUDGE=$JUDGE"
echo "[live] key present: $( [ -n "$WALLET_PVK" ] && echo yes || echo no )"
exec npx tsx scripts/live-headless.ts "${1:-86400}"