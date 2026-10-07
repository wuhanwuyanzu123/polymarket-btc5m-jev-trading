#!/bin/sh
# 第二套 dry-run：每笔 $1，与 $5 那套完全隔离（独立账本、独立日志）。
# 规则与 $5 那套完全一致，只有 BET_USD 不同，用于对比"小金额"的表现。
# shell 里 export 的值优先于 .env（见 src/loadEnv.ts）。
cd /tmp/edge-analysis || exit 1

export NODE_USE_ENV_PROXY=1
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export NO_PROXY="data-api.binance.vision,localhost,127.0.0.1,::1"
export BINANCE_BASE_URL=https://data-api.binance.vision

# 与主 dry-run 的关键区别
export BET_USD=1
export PNL_PATH=data/pnl-1usd.jsonl
export JEV_LOG_PATH=data/jev-log-1usd.jsonl

# 绝不能碰实盘
export LIVE_TRADING=0

exec npx tsx scripts/dryrun-headless.ts 86400
