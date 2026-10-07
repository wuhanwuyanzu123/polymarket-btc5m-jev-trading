#!/usr/bin/env python3
"""Serve the dry-run curve page and compute drycurve.json from the live ledger.

Static files are served as-is; /drycurve.json (and /drycurve-1usd.json) are
generated on request so the chart never shows a stale snapshot.
"""
import argparse
import json
import os
import shlex
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

STATIC_FILES = {"": "dry-run-curve.html", "/": "dry-run-curve.html", "/dry-run-curve.html": "dry-run-curve.html"}


def read_ledger(path, ssh_key=None):
    """Read a ledger from a local path or from ssh://user@host/path.

    Remote reads keep the local chart in sync after the dry-runs moved to the
    82 server — the local copy of the ledger is frozen at the migration point.
    """
    if not path.startswith("ssh://"):
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as fh:
            return fh.read().splitlines()
    rest = path[len("ssh://") :]
    host, _, remote = rest.partition("/")
    remote = "/" + remote
    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]
    if ssh_key:
        cmd += ["-i", ssh_key, "-o", "IdentitiesOnly=yes"]
    cmd += [host, "cat " + shlex.quote(remote)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=20)
    except (subprocess.SubprocessError, OSError):
        return []
    if proc.returncode != 0:
        return []
    return proc.stdout.splitlines()


def build_curve(ledger_path, stake, ssh_key=None):
    rows = []
    for line in read_ledger(ledger_path, ssh_key):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # mirror src/pnl/ledger.ts: skip corrupt lines
    out = []
    cum = 0.0
    peak = 0.0
    for i, row in enumerate(rows, 1):
        pnl = float(row.get("pnlUsd") or 0)
        cum += pnl
        peak = max(peak, cum)
        settled = row.get("settledAt")
        try:
            when = datetime.fromisoformat(str(settled).replace("Z", "+00:00"))
            label = when.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            label = "?"
        out.append(
            {
                "i": i,
                "cum": round(cum, 2),
                "dd": round(cum - peak, 2),
                "t": label,
                "pnl": round(pnl, 6),
                "entry": row.get("entryPrice"),
                "win": pnl > 0,
                "winner": row.get("winner"),
                "side": row.get("positionSide"),
            }
        )
    return out, stake


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="directory of static chart files")
    ap.add_argument("--ledger", required=True, help="$5 dry-run ledger path")
    ap.add_argument("--ledger-1usd", default=None, help="$1 dry-run ledger path")
    ap.add_argument("--stake", type=float, default=5.0)
    ap.add_argument("--stake-1usd", type=float, default=1.0)
    ap.add_argument("--ssh-key", default=None, help="key for ssh:// ledgers")
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8777)
    args = ap.parse_args()

    root = os.path.abspath(args.dir)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *fmt_args):  # keep journal quiet
            pass

        def _send(self, code, body, ctype):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/drycurve.json":
                data, _ = build_curve(args.ledger, args.stake, args.ssh_key)
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                return self._send(200, body, "application/json; charset=utf-8")
            if path == "/drycurve-1usd.json":
                if not args.ledger_1usd:
                    return self._send(404, b"not configured", "text/plain")
                data, _ = build_curve(args.ledger_1usd, args.stake_1usd, args.ssh_key)
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                return self._send(200, body, "application/json; charset=utf-8")
            if path == "/healthz":
                return self._send(200, b"ok", "text/plain")
            name = STATIC_FILES.get(path)
            if not name:
                return self._send(404, b"not found", "text/plain")
            full = os.path.join(root, os.path.basename(name))
            if not os.path.isfile(full):
                return self._send(404, b"not found", "text/plain")
            with open(full, "rb") as fh:
                body = fh.read()
            ctype = "text/html; charset=utf-8" if name.endswith(".html") else "application/octet-stream"
            return self._send(200, body, ctype)

    ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
