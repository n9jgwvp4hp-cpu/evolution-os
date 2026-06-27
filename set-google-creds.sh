#!/usr/bin/env bash
# Securely set Google OAuth credentials on the live Evolution OS app.
# CLIENT_ID + CLIENT_SECRET are read at hidden prompts (never echoed, never in
# shell history, never committed). GOOGLE_REDIRECT_URI is set automatically to
# the app's production callback. Values go only into a temp spec that's deleted
# immediately; DigitalOcean stores the secrets encrypted.
set -euo pipefail

APP=21dfe73b-1b88-4f85-b151-14bc047b49c6
DOCTL="$HOME/bin/doctl"
REDIRECT="https://evolution-os-dlfmv.ondigitalocean.app/api/google/callback"

read -rs -p "Paste GOOGLE_CLIENT_ID (hidden), then Enter: " GCID; echo
read -rs -p "Paste GOOGLE_CLIENT_SECRET (hidden), then Enter: " GSEC; echo
GCID="$(printf '%s' "$GCID" | tr -d '[:space:]')"
GSEC="$(printf '%s' "$GSEC" | tr -d '[:space:]')"
if [ -z "$GCID" ] || [ -z "$GSEC" ]; then echo "Missing a value. Aborting."; exit 1; fi

TMP="$(mktemp)"; TMP2="$(mktemp)"; trap 'rm -f "$TMP" "$TMP2"' EXIT
"$DOCTL" apps spec get "$APP" > "$TMP"

GCID="$GCID" GSEC="$GSEC" GREDIR="$REDIRECT" python3 - "$TMP" "$TMP2" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
cid, csec, redir = os.environ["GCID"], os.environ["GSEC"], os.environ["GREDIR"]
lines = open(src).read().splitlines()

# 1) drop any existing GOOGLE_* env blocks (idempotent re-runs)
clean, i = [], 0
while i < len(lines):
    m = re.match(r'^(\s*)- key:\s*(GOOGLE_\w+)', lines[i])
    if m:
        indent = len(m.group(1)); i += 1
        while i < len(lines):
            nxt = lines[i]
            if nxt.strip() == "" or (len(nxt) - len(nxt.lstrip())) <= indent:
                break
            i += 1
        continue
    clean.append(lines[i]); i += 1

# 2) insert the three vars right after the service's `envs:` line
out, done = [], False
for line in clean:
    out.append(line)
    if not done:
        m = re.match(r'^(\s*)envs:\s*$', line)
        if m:
            ind = m.group(1)
            def block(k, v, secret):
                b = [f"{ind}- key: {k}", f"{ind}  scope: RUN_AND_BUILD_TIME"]
                if secret: b.append(f"{ind}  type: SECRET")
                b.append(f"{ind}  value: '{v}'")
                return b
            out += block("GOOGLE_CLIENT_ID", cid, True)
            out += block("GOOGLE_CLIENT_SECRET", csec, True)
            out += block("GOOGLE_REDIRECT_URI", redir, False)
            done = True
open(dst, "w").write("\n".join(out) + "\n")
PY

"$DOCTL" apps update "$APP" --spec "$TMP2" >/dev/null
echo "✓ Google credentials set; redirect URI = $REDIRECT"
echo "  Redeploy is running (~3 min). Then open /connections and click Connect Google."
