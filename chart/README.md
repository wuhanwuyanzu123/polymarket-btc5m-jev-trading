# 收益曲线图表

把 dry-run 账本（`data/pnl-*.jsonl`）画成累计盈亏曲线 + 每笔盈亏条形图。

原来的做法是生成一份静态 `drycurve.json`，生成完就不再更新——曲线会停在生成那一刻，
和实时账本对不上。这里改成**每次请求都从账本现算**，所以曲线永远是最新的。

## 文件

| 文件 | 作用 |
|---|---|
| `dry-run-curve.html` | 纯静态页面，自己画 SVG，不依赖任何外部库 |
| `serve-curve.py` | 轻量 HTTP 服务：静态页原样返回，`/drycurve.json` 按需从账本计算 |

## 跑起来

只看本地账本：

```bash
python3 chart/serve-curve.py \
  --dir chart \
  --ledger data/pnl.jsonl \
  --bind 127.0.0.1 --port 8777
```

账本在另一台机器上时，用 `ssh://` 直接远程读，不用把账本同步到本地：

```bash
python3 chart/serve-curve.py \
  --dir chart \
  --ledger ssh://root@example.com/opt/app/data/pnl-5usd.jsonl \
  --ledger-1usd ssh://root@example.com/opt/app/data/pnl-1usd.jsonl \
  --ssh-key ~/.ssh/id_ed25519 \
  --bind 127.0.0.1 --port 8777
```

然后打开 `http://127.0.0.1:8777/dry-run-curve.html`。

## 接口

- `/drycurve.json` — `$5` 那套（`--ledger`），字段与页面约定一致
- `/drycurve-1usd.json` — `$1` 那套（`--ledger-1usd`），未配置时 404
- `/healthz` — 存活探针

每条记录：`i, cum, dd, t, pnl, entry, win, winner, side`。
`t` 是 `settledAt` 的 UTC 时间，`dd` 是相对历史峰值的回撤。

## 注意

- 账本里损坏的行会被跳过，和 `src/pnl/ledger.ts` 的 `readRecords` 行为一致。
- 累计盈亏只统计**已结算**的行，未结算的持仓不计入。
- 页面顶部的笔数是账本行数，不是交易所成交笔数；FOK 被拒的单子不会进账本。
- 绑 `0.0.0.0` 会把你的盈亏曲线暴露给公网（只含盈亏数字，无地址、无私钥）。
  只给自己看就绑 `127.0.0.1`，再用 SSH 隧道访问：
  `ssh -N -L 8777:127.0.0.1:8777 user@host`
