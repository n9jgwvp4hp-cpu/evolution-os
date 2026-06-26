# Deploying Evolution OS to DigitalOcean

This is the permanent home for Evolution OS: a **DigitalOcean App Platform**
web service running the Next.js app + the in-process mission worker, backed by
**DigitalOcean Managed PostgreSQL**.

Once deployed, missions execute on the server 24/7 — independent of your phone
or browser. Open the app, speak an objective, leave, come back later: the work
ran and the result is waiting.

```
                 ┌─────────────────────────────────────────┐
   your phone →  │  App Platform: Next.js web + mission     │
   (browser)     │  worker (instance_count = 1, always on)  │
                 └───────────────┬─────────────────────────┘
                                 │  (private network, TLS)
                                 ▼
                 ┌─────────────────────────────────────────┐
                 │  Managed PostgreSQL  →  the brain        │
                 │  (missions, memory, tasks, contacts,     │
                 │   deals, notes)                          │
                 └─────────────────────────────────────────┘
```

---

## What you need before starting
These are the only blocking items — each requires **your** account / billing /
credentials (I can't create them for you):

1. **A DigitalOcean account** with billing enabled — <https://cloud.digitalocean.com>
2. **A GitHub repo** App Platform can pull from (this project, already on
   `feature/personal-ai-assistant`; merge to `main` or deploy that branch).
3. **An OpenAI API key** for production — <https://platform.openai.com/api-keys>
4. *(Optional)* **Google OAuth credentials** if you want live Gmail + Calendar.

Estimated cost: ~**$5/mo** App Platform (Basic) + ~**$7–15/mo** smallest
Managed Postgres. Resize anytime.

---

## Step 1 — Get the code on GitHub
Push this repo to GitHub (or merge the working branch into `main`):

```bash
git push -u origin feature/personal-ai-assistant
# then open a PR and merge to main, or deploy the branch directly in Step 3
```

## Step 2 — Create the Managed PostgreSQL database
DigitalOcean → **Databases → Create Database Cluster**:

- Engine: **PostgreSQL 16**
- Plan: smallest is fine to start (e.g. **1 GB / 1 vCPU**)
- Same **region** you'll use for the app (e.g. `NYC3`)
- Create, then on the cluster's **Overview/Connection Details** copy the
  **connection string** (looks like
  `postgresql://doadmin:••••@db-...ondigitalocean.com:25060/defaultdb?sslmode=require`).

You don't need to create tables — Evolution creates them on first boot.

> If you use the App Platform spec in Step 3, you can instead let the spec
> provision the DB and bind `DATABASE_URL` automatically (`${evolution-db.DATABASE_URL}`).

## Step 3 — Create the App Platform app
**Option A — from the repo (UI):**
1. DigitalOcean → **Apps → Create App** → pick your GitHub repo + branch.
2. It detects Next.js. Confirm:
   - Build command: `npm run build`
   - Run command: `npm start`
   - HTTP port: `3000`
   - **Instances: 1** (required — see "The worker" below).
3. Attach the database from Step 2 (or add a dev DB component).

**Option B — from the spec (recommended, reproducible):**
1. Edit [`.do/app.yaml`](.do/app.yaml): set `<YOUR_GITHUB_REPO>` and (after first
   deploy) `<YOUR_APP_DOMAIN>`.
2. ```bash
   doctl apps create --spec .do/app.yaml
   ```

## Step 4 — Set environment variables
In the App's **Settings → App-Level Environment Variables** (mark the secrets as
**encrypted**):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Step 2), or bound from the DB component. **Secret.** |
| `OPENAI_API_KEY` | ✅ | Your production OpenAI key. **Secret.** |
| `OPENAI_MODEL` | – | Defaults to `gpt-4o-mini`. |
| `NODE_ENV` | ✅ | `production` |
| `GOOGLE_CLIENT_ID` | optional | For Gmail/Calendar. **Secret.** |
| `GOOGLE_CLIENT_SECRET` | optional | **Secret.** |
| `GOOGLE_REDIRECT_URI` | optional | `https://<your-app-domain>/api/google/callback` |
| `DISABLE_WORKER` | – | Leave empty. Only set `true` if you run a separate worker. |

Setting `DATABASE_URL` is what flips Evolution from the local file store to
Postgres — no code change needed.

## Step 5 — Update Google OAuth for production (only if using Gmail/Calendar)
In **Google Cloud Console → Credentials → your OAuth client**, add an
**Authorized redirect URI**:

```
https://<your-app-domain>/api/google/callback
```

and set `GOOGLE_REDIRECT_URI` to the same value. (Keep the localhost one too for
dev.)

## Step 6 — Deploy & verify
App Platform builds and deploys on push. After it goes live:

1. Open `https://<your-app-domain>` — you should land on the voice chat.
2. Open the app once (or hit `/api/missions`), then in the runtime **logs**
   confirm: `[Evolution OS] mission worker started (store: postgres)`
3. Smoke-test persistence:
   ```bash
   APP=https://<your-app-domain>
   curl -s -X POST $APP/api/tools/save_memory -H 'Content-Type: application/json' \
     -d '{"text":"Production is live"}'
   curl -s $APP/api/data/memories
   ```
4. Speak an objective in the app, close the tab, reopen later — the result is
   waiting.

---

## The worker (read this)
The mission worker runs **in-process** in the web service. It starts lazily on
the first request to `/api/missions` after a (re)start — and the app polls that
endpoint, so it boots within seconds of the app being opened and then runs
continuously. Keep the web service at **`instance_count: 1`** so exactly one
worker runs. With two instances, two workers would race on the same missions.

To scale the web tier later, split the worker into its own App Platform
component (a second service with no HTTP route) and set `DISABLE_WORKER=true`
on the web service. The Postgres `mutate()` uses `SELECT … FOR UPDATE`, so the
store is already safe for multiple writers when you do.

## Backups & data
- Managed Postgres includes automated daily backups + point-in-time recovery.
- The brain is one JSONB row in table `evolution_state`; export it with
  `pg_dump` or `SELECT state FROM evolution_state;` anytime.
- Local dev data stays in `.data/` (gitignored) and does **not** travel to
  production — production starts with an empty brain.

## Troubleshooting
- **`store: file` in logs on production** → `DATABASE_URL` isn't set on the web
  service. Add it and redeploy.
- **DB connection errors / SSL** → ensure the connection string ends with
  `?sslmode=require`; the app negotiates TLS automatically.
- **Missions stay `queued`** → the worker isn't running. Check `DISABLE_WORKER`
  isn't `true` and the instance is healthy.
- **Google "redirect_uri_mismatch"** → the production redirect URI in Step 5
  must exactly match `GOOGLE_REDIRECT_URI`.

## Next milestone (after this is live)
Push notifications to a **closed** app (Web Push / VAPID) so completion alerts
arrive even when Evolution isn't open. Needs the live host (this) + a one-time
in-app permission grant.
