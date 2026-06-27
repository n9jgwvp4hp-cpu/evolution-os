#!/usr/bin/env bash
# Securely set OPENAI_API_KEY on the live Evolution OS app.
# The key is read at a hidden prompt — never echoed, never in shell history,
# never committed. It goes only into a temp spec that's deleted immediately,
# and DigitalOcean stores it encrypted.
set -euo pipefail

APP=21dfe73b-1b88-4f85-b151-14bc047b49c6
DOCTL="$HOME/bin/doctl"

read -rs -p "Paste your OpenAI API key, then press Enter (input hidden): " OPENAI_KEY
echo
OPENAI_KEY="$(printf '%s' "$OPENAI_KEY" | tr -d '[:space:]')"
if [ -z "${OPENAI_KEY:-}" ]; then echo "No key entered. Aborting."; exit 1; fi
case "$OPENAI_KEY" in
  sk-*) : ;;
  *) echo "That does not look like an OpenAI key (should start with sk-). Aborting."; exit 1 ;;
esac

TMP="$(mktemp)"; TMP2="$(mktemp)"
trap 'rm -f "$TMP" "$TMP2"' EXIT

"$DOCTL" apps spec get "$APP" > "$TMP"
OPENAI_KEY="$OPENAI_KEY" python3 - "$TMP" "$TMP2" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
key = os.environ["OPENAI_KEY"]
out, pending = [], False
for line in open(src).read().splitlines():
    if re.search(r"key:\s*OPENAI_API_KEY", line):
        pending = True; out.append(line); continue
    if pending and re.match(r"\s*value:", line):
        indent = line[: len(line) - len(line.lstrip())]
        out.append(f"{indent}value: '{key}'"); pending = False; continue
    out.append(line)
open(dst, "w").write("\n".join(out) + "\n")
PY

"$DOCTL" apps update "$APP" --spec "$TMP2" >/dev/null
echo "✓ OpenAI key set on the live app. A redeploy is now running (~3 min)."
echo "  Tell the assistant 'key set' to verify."
