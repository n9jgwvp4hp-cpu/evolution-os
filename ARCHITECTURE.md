# Evolution OS — Runtime Architecture & Deployment Plan

This is the deployment plan for Evolution OS as an **executive operating
system**: an always-on runtime that executes missions 24/7, one brain shared by
every device, optimized for **reliability and long-term architecture — not
cost**. It targets **DigitalOcean** and is designed to grow into desktop control
and an agent workforce without re-platforming.

For click-by-click setup steps, see [DEPLOYMENT.md](DEPLOYMENT.md). This document
is the *why* and the *shape*.

---

## 1. Target topology

```
            ┌──────── phone (PWA) ───────┐     ┌──── desktop (browser) ────┐
            │  voice, chat, results       │     │  same app, same brain      │
            └───────────────┬─────────────┘     └─────────────┬─────────────┘
                            │  HTTPS (one domain)             │
                            └───────────────┬─────────────────┘
                                            ▼
                          ┌─────────────────────────────────────┐
                          │  WEB  (Next.js, stateless)           │  App Platform
                          │  serves UI + API, no mission work    │  Service, autoscale
                          └───────────────┬─────────────────────┘
                                          │  shared DB (private network, TLS)
            ┌─────────────────────────────┼──────────────────────────────┐
            ▼                             ▼                                ▼
 ┌────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────┐
 │ WORKER (always-on) │     │  Managed PostgreSQL       │     │ (future) Agent /      │
 │ executes missions  │────▶│  THE BRAIN: missions,     │◀────│ Desktop gateway:      │
 │ 24/7, independent  │     │  memory, tasks, contacts, │     │ remote executors      │
 │ of any device      │     │  deals, notes, results    │     │ register + pull work  │
 └────────────────────┘     │  HA standby + PITR backups│     └──────────────────────┘
                            └──────────────────────────┘
```

**The core principle:** mission execution lives in the **Worker**, the brain
lives in **Postgres**, and **devices are only views**. Nothing the user owns has
to be awake for work to happen.

---

## 2. Why this stack (reliability + lowest maintenance)

| Decision | Choice | Why (not cheapest — most reliable / least ops) |
|---|---|---|
| Runtime | **DO App Platform** (managed PaaS) | Managed TLS, health checks, auto-restart on crash, zero-downtime deploys, git push → deploy. **No servers to patch.** Rejected: Droplets/Kubernetes — more control, far more maintenance and failure surface. |
| Database | **DO Managed PostgreSQL** (production plan, HA standby) | Managed failover, daily backups + point-in-time recovery, automatic patching. The brain is the one thing that must never be lost. Rejected: DB-on-a-Droplet (you own backups, failover, patching). |
| Web ↔ Worker | **Separate components** | The worker must run regardless of web traffic, deploys, or scaling. Coupling them means a web restart can interrupt a mission. |
| State | **All server-side** (already built) | Devices hold no brain state, so phone/desktop are automatically consistent and disposable. |
| Deploys | **Auto-deploy from main** | Lowest-maintenance release path; no manual ops. |

---

## 3. Components

### Web service (Next.js)
Serves the UI and the API (`/api/agent`, `/api/tools`, `/api/data`,
`/api/missions`, Google OAuth). **Stateless** — safe to autoscale horizontally
and redeploy anytime. Set `DISABLE_WORKER=true` here so only the dedicated
worker executes missions.

### Worker (always-on runtime)
A long-running process that runs the mission loop continuously. This is what
makes "missions continue when every device is offline" literally true. Today the
worker is in-process and starts on first request; the plan promotes it to its
own component (see §5, Phase 2) with a tiny entrypoint:

```ts
// worker.ts — dedicated always-on worker entrypoint
import { startWorker } from "@/lib/server/missionEngine";
startWorker();
setInterval(() => {}, 1 << 30); // keep the process alive
```
…run as a separate App Platform **Worker** component (`run_command: node worker.js`),
with `DATABASE_URL` set and `DISABLE_WORKER` unset. The web service sets
`DISABLE_WORKER=true`.

### Managed PostgreSQL — the brain
Stores missions, memory, tasks, contacts, deals, notes, results, and Google
tokens. The app already speaks Postgres when `DATABASE_URL` is set
(`lib/server/db.ts`). For reliability choose a **production plan with a standby
node** (automatic failover) and keep **PITR** on. Same region as the app for
low-latency private networking.

### Domain, TLS, PWA
One custom domain with auto-provisioned TLS. The app is already an installable
PWA (manifest + icons), so the phone gets a home-screen "Evolution" that opens
straight into voice. Set `GOOGLE_REDIRECT_URI` to the production domain.

### Secrets
All keys (`OPENAI_API_KEY`, `DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, optional
`BRAVE_SEARCH_API_KEY`/`SERPAPI_KEY`) live as **encrypted env vars** on the
platform — never in the repo.

### Reliability practices
- **Backups:** Managed PG daily + PITR; plus a scheduled logical export of the
  `evolution_state` brain for off-platform safety.
- **Monitoring/alerts:** uptime + crash alerts on web and worker; DB CPU/disk
  alerts. The worker already logs its store backend on boot.
- **Restart policy:** App Platform auto-restarts a crashed component; the worker
  resumes in-flight missions on boot (verified) — so a restart never loses work.

---

## 4. How the six requirements are met

| Requirement | Met by | Status after deploy |
|---|---|---|
| Always-on runtime | Dedicated Worker component on managed PaaS | ✅ |
| Phone + desktop share one brain | Single server-side Postgres brain; both devices are views of one URL | ✅ (already proven in code) |
| Missions continue when devices are offline | Execution is in the Worker, never the device | ✅ |
| Persistent memory | Managed Postgres + backups/PITR | ✅ |
| Lowest maintenance | Managed runtime + managed DB + auto-deploy; nothing self-hosted | ✅ |
| Scalable to desktop control + agent workforce | Web/worker split now; tables + queue + agent gateway later (§5) | 🟡 path defined |

---

## 5. Phased rollout

**Phase 1 — Launch (fastest path to always-on).**
Single App Platform web service (`instance_count: 1`, in-process worker) +
Managed Postgres. This already delivers requirements 1–5. Lowest possible
moving parts. (This is what [DEPLOYMENT.md](DEPLOYMENT.md) sets up.)

**Phase 2 — Decouple the runtime (reliability).**
Promote the worker to its own always-on component (`worker.ts` above); set
`DISABLE_WORKER=true` on web; turn on DB **HA standby**. Now web deploys/scaling
never touch mission execution, and DB failover is automatic. Web can autoscale.

**Phase 3 — Agent workforce (scale-out execution).**
To run many agents/missions in parallel across multiple worker instances, evolve
the store from the single JSONB document to **first-class tables** — most
importantly a `missions` table claimed with
`SELECT … FOR UPDATE SKIP LOCKED`. That lets N workers pull distinct missions
with zero double-execution (replacing today's single-instance `inflight` set).
The data service interface (`lib/server/data.ts`) stays the same; only the
storage layer changes. Concurrency cap moves from per-process to a fleet target.

**Phase 4 — Desktop control & remote executors.**
Desktop control is just another *executor* that registers with the brain and
pulls action requests — same pattern as the mission worker, but running on a
desktop and exposing OS-level capabilities. The backend gains a small **agent
gateway** (authenticated outbound channel, e.g. WebSocket) so desktop agents and
future remote workers connect to the same brain and capability protocol. Because
capabilities are already a typed registry and execution is already decoupled
from the UI, this is an extension, not a rewrite.

---

## 6. What only you can do (account / billing / credentials)
I can prepare every file and the exact steps; these require your accounts:

1. **DigitalOcean account + billing** — to create the App + Managed Postgres.
2. **Production-tier Managed Postgres** (with standby for HA) — a billing choice.
3. **Production `OPENAI_API_KEY`** — your key, set as a platform secret.
4. **Custom domain** (optional) — DNS you control.
5. **Google OAuth** prod redirect — your Google Cloud project (only if using
   Gmail/Calendar).
6. *(Optional)* **`BRAVE_SEARCH_API_KEY` / `SERPAPI_KEY`** — upgrades research
   depth/reliability beyond the keyless default.

Everything else — the app spec (`.do/app.yaml`), Dockerfile, Postgres-ready
store, worker design, and step-by-step guide — is already in the repo.

---

## 7. Cost posture (reliability-tier, indicative)
Optimized for reliability, not the floor:
- App Platform web (Basic/Professional, 1–2 instances): ~$12–24/mo
- App Platform worker component: ~$5–12/mo
- Managed Postgres with HA standby: ~$30–60/mo
- Total: roughly **$50–95/mo** for an always-on, backed-up, low-maintenance
  executive runtime. Scale the DB and worker tiers up as the agent workforce
  grows.
