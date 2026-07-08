# Continuous Workflow Orchestrator

Evolution OS can advance its own roadmap. The **orchestrator** implements one
roadmap milestone at a time (Claude Code → build → verify → deploy → production
health → mark done, with bounded repair retries). The **persistent runner** keeps
it going on a schedule so you don't have to run it by hand.

## Start / stop (one command each)

```bash
npm run orchestrate:start     # start the persistent runner (background, survives closing the terminal)
npm run orchestrate:status    # is it running?
npm run orchestrate:logs      # live-tail the run log
npm run orchestrate:stop      # stop it
```

Status also appears live in the **Operations Command Center** (`/ops`) — last run,
current milestone, completed count, failed milestone (if any), and the next
scheduled run.

### Run once, by hand (no daemon)

```bash
npm run orchestrate           # advance milestones until blocked/empty, then exit
npm run orchestrate:once      # advance exactly one milestone
npm run orchestrate:dry       # rehearse the machinery — no Claude, no commit, no deploy
```

## What it does each cycle

1. Reads the first unfinished milestone in `roadmap.json` (status `pending`, or
   `failed` with retries left).
2. Generates a Claude Code prompt and runs `claude` headless to implement it.
3. **Safety-guards the diff** — see below.
4. Runs `npm run build` + the milestone's `verify` commands.
5. Commits, pushes, and redeploys to DigitalOcean.
6. Checks production health (`/api/health`, `/api/ops`).
7. Marks the milestone `done` — or writes a repair prompt and retries (bounded).

## Safety — no infinite loops, no runaway spend

- **Only runs when there's work.** If every milestone is `done`, the runner just
  polls quietly (no Claude, no spend).
- **Hard caps:** `ORCH_DAILY_MAX` milestones per day (default **6**) and
  `ORCH_SESSION_MAX` per start (default **20**); a minimum `ORCH_INTERVAL_MIN`
  between runs (default **30 min**). Idle poll every `ORCH_IDLE_MIN` (default 60).
- **Bounded retries:** each milestone gets at most `ORCH_MAX_RETRIES` attempts
  (default 3); then it's marked `failed`.
- **Stops on failure.** If a milestone's build, deploy, or production-health check
  fails (or a safety violation occurs), the runner **stops and reports** instead
  of looping — you fix it, then `npm run orchestrate:start` again.
- **Protected changes require approval.** The orchestrator refuses to auto-commit
  changes that delete core files (mission engine, store, db, `/ops`, kernel),
  touch env/secrets/`.do/`, or add npm dependencies. It **stashes** the change and
  halts; review with `git stash list` / `git stash pop`.

## Configuration (env vars, all optional)

| Var | Default | Meaning |
|-----|---------|---------|
| `ORCH_INTERVAL_MIN` | 30 | minutes between milestone runs |
| `ORCH_IDLE_MIN` | 60 | minutes between polls when idle |
| `ORCH_DAILY_MAX` | 6 | max milestones per calendar day |
| `ORCH_SESSION_MAX` | 20 | max milestones per daemon start |
| `ORCH_MAX_RETRIES` | 3 | attempts per milestone before failing |

Example: `ORCH_DAILY_MAX=3 ORCH_INTERVAL_MIN=60 npm run orchestrate:start`

## Adding work

Edit `roadmap.json` — add milestones (each: `id`, `title`, `goal`, `verify`,
`status: "pending"`, `attempts: 0`) in priority order. The runner picks them up.

## Logs

Everything is written to `logs/` (git-ignored): `daemon-<date>.log` (the runner)
and `orchestrator-<date>.log` (each cycle).

## Persist across reboots (optional, macOS)

The runner survives closing the terminal (it's `nohup`ed). To also survive a
reboot, wrap `npm run orchestrate:start` in a `launchd` agent, or simply re-run
`npm run orchestrate:start` after logging in.
