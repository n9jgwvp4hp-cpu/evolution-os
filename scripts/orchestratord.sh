#!/bin/bash
# Control the persistent orchestrator runner: start | stop | status | logs
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
PIDFILE="logs/daemon.pid"
LOG="logs/daemon-$(date +%F).log"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-}" in
  start)
    if running; then echo "already running (pid $(cat "$PIDFILE"))"; exit 0; fi
    nohup node scripts/orchestrator-daemon.mjs >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "✅ persistent orchestrator started (pid $(cat "$PIDFILE"))"
    echo "   logs: $LOG   ·   stop: npm run orchestrate:stop"
    ;;
  stop)
    if running; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 1; rm -f "$PIDFILE"; echo "🛑 stopped"; else rm -f "$PIDFILE" 2>/dev/null || true; echo "not running"; fi
    ;;
  status)
    if running; then echo "running (pid $(cat "$PIDFILE"))"; else echo "not running"; fi
    ;;
  logs)
    tail -n 80 -f "logs/daemon-$(date +%F).log"
    ;;
  *)
    echo "usage: $0 {start|stop|status|logs}"; exit 1
    ;;
esac
