#!/usr/bin/env bash
# Securely set Google OAuth credentials on the live Evolution OS app, with a
# live pre-check against Google so a wrong secret is caught BEFORE deploying.
# Values are read at hidden prompts (never echoed, never in shell history,
# never committed). Only the CLIENT_SECRET is stored encrypted; the CLIENT_ID
# is public (it appears in the OAuth URL) and is stored readable for diagnosis.
set -euo pipefail

APP=21dfe73b-1b88-4f85-b151-14bc047b49c6
DOCTL="$HOME/bin/doctl"
REDIRECT="https://evolution-os-dlfmv.ondigitalocean.app/api/google/callback"

read -rs -p "Paste GOOGLE_CLIENT_ID (hidden), then Enter: " GCID; echo
read -rs -p "Paste GOOGLE_CLIENT_SECRET (hidden), then Enter: " GSEC; echo
GCID="$(printf '%s' "$GCID" | tr -d '[:space:]')"
GSEC="$(printf '%s' "$GSEC" | tr -d '[:space:]')"
[ -z "$GCID" ] || [ -z "$GSEC" ] && { echo "✗ Missing a value. Aborting."; exit 1; }

# --- format sanity (catches the most common: ID/secret swapped) ---
case "$GCID" in
  *.apps.googleusercontent.com) : ;;
  *) echo "✗ CLIENT_ID should end in .apps.googleusercontent.com — did you swap the ID and secret?"; exit 1 ;;
esac
case "$GSEC" in
  GOCSPX-*) : ;;
  *) echo "✗ CLIENT_SECRET should start with GOCSPX- — did you swap the ID and secret, or paste the wrong value?"; exit 1 ;;
esac

# --- LIVE pre-check against Google's token endpoint with a dummy code ---
# invalid_client => credentials are wrong.  invalid_grant => credentials are
# VALID (Google accepted the client; only the dummy code was rejected).
echo "Verifying credentials with Google…"
ERR=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d grant_type=authorization_code -d code=evolution_precheck_dummy \
  -d "redirect_uri=$REDIRECT" -d "client_id=$GCID" -d "client_secret=$GSEC" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('error',''))" 2>/dev/null || true)
case "$ERR" in
  invalid_grant) echo "✓ Google accepted the client_id + secret." ;;
  invalid_client) echo "✗ Google rejected these credentials (invalid_client). The secret doesn't match the ID. Copy both from the SAME OAuth client (the evolution-os Web app)."; exit 1 ;;
  *) echo "✗ Unexpected verification result ('$ERR'). Not deploying. Re-check the values."; exit 1 ;;
esac

# --- write to the live app spec (CLIENT_ID readable, SECRET encrypted) ---
TMP="$(mktemp)"; TMP2="$(mktemp)"; trap 'rm -f "$TMP" "$TMP2"' EXIT
"$DOCTL" apps spec get "$APP" > "$TMP"
GCID="$GCID" GSEC="$GSEC" GREDIR="$REDIRECT" python3 - "$TMP" "$TMP2" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
cid, csec, redir = os.environ["GCID"], os.environ["GSEC"], os.environ["GREDIR"]
lines = open(src).read().splitlines()
clean, i = [], 0
while i < len(lines):                       # drop existing GOOGLE_* blocks
    m = re.match(r'^(\s*)- key:\s*(GOOGLE_\w+)', lines[i])
    if m:
        ind = len(m.group(1)); i += 1
        while i < len(lines) and not (lines[i].strip()=="" or (len(lines[i])-len(lines[i].lstrip()))<=ind):
            i += 1
        continue
    clean.append(lines[i]); i += 1
out, done = [], False
for line in clean:
    out.append(line)
    if not done and re.match(r'^(\s*)envs:\s*$', line):
        ind = re.match(r'^(\s*)envs:', line).group(1)
        def blk(k, v, secret):
            b = [f"{ind}- key: {k}", f"{ind}  scope: RUN_AND_BUILD_TIME"]
            if secret: b.append(f"{ind}  type: SECRET")
            b.append(f"{ind}  value: '{v}'"); return b
        out += blk("GOOGLE_CLIENT_ID", cid, False)     # public, readable
        out += blk("GOOGLE_CLIENT_SECRET", csec, True)  # encrypted
        out += blk("GOOGLE_REDIRECT_URI", redir, False)
        done = True
open(dst, "w").write("\n".join(out) + "\n")
PY

"$DOCTL" apps update "$APP" --spec "$TMP2" >/dev/null
echo "✓ Credentials verified and set; redeploy running (~3 min)."
echo "  When it's live, open /connections and click Connect Google — it will work."
