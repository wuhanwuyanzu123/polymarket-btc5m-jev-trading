#!/bin/sh
cd /tmp/edge-analysis || exit 1
# Binance is reachable directly and is faster+more reliable that way; only
# Polymarket needs the local proxy. Without NO_PROXY every request goes through
# the proxy and roughly half the Binance pulls fail.
export NODE_USE_ENV_PROXY=1
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export NO_PROXY="data-api.binance.vision,localhost,127.0.0.1,::1"
export BINANCE_BASE_URL=https://data-api.binance.vision
exec npx tsx scripts/dryrun-headless.ts 86400
