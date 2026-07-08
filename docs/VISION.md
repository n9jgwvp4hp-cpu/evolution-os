# Evolution OS — Architecture Audit & Transition Plan

**Vision reset.** Evolution OS is a *personal operating system* whose job is to
move the user's life, businesses, and objectives forward with minimal effort.
The user defines **direction, priorities, and approvals**. The OS determines
everything else. The product spine is:

> OBJECTIVES → MEMORY → REASONING → MISSIONS → EXECUTION → CONTINUOUS IMPROVEMENT

The good news from the audit: **five of those six layers already exist and are
production-proven.** Only the top layer (Objectives) is missing, and the front
door presents the wrong thing (a drawer of tools instead of objectives). This is
a **re-framing and a spine, not a rebuild** — no completed work is thrown away.

---

## The spine mapped to what exists today

| Layer | Status today | Gap |
|---|---|---|
| **Objectives** | ❌ none — missions hold an objective *string*, nothing persistent to reason around | **New primitive** |
| **Memory** | ✅ brain (`memories`, notes, CRM, deals) injected into every mission/kernel run | Objective-scoped state/knowledge |
| **Reasoning** | ✅ the Kernel: perceive (email/cal/pending) → decide → **Priority Queue** (ranked, with *why*) | Re-scope from global triage → **per-objective planning** |
| **Missions** | ✅ persistent, exactly-once, resumable, retried, status-logged (Postgres) | Link to objectives; add pause/reprioritize |
| **Execution** | ✅ real tool engine (Gmail/Calendar/web/CRM/files), auto-retry, output-logged | None structural |
| **Continuous improvement** | ⚠️ retries + QC + recurring kernel | No cross-cycle **learning** from approvals/outcomes |

**The 6 home-screen questions are almost entirely answerable *today* from existing data:**

| Home question | Backed by |
|---|---|
| 1. What are my Objectives? | ❌ **new** |
| 2. What is it working on now? | ✅ active missions (`/api/ops`) |
| 3. What completed while I was away? | ✅ mission history + `acknowledged` |
| 4. What is blocked? | ✅ `failed` / `needs_approval` missions |
| 5. What decisions require me? | ✅ approvals + drafts + calendar suggestions |
| 6. What does it recommend next? | ✅ Priority Queue (`why` + `recommendedAction`) |

So the work is: **(a)** add Objectives as the organizing spine, **(b)** re-point
the reasoning from global triage to per-objective planning, **(c)** redesign the
front door to objectives + the 6 questions, **(d)** demote tools/automations to
"advanced."

---

## 1. Components that ALREADY support the vision (keep, reuse)

- **Mission engine + store + worker** — the EXECUTION backbone (persistent,
  exactly-once, resume, retry, status log). Unchanged; missions just gain an owner.
- **Tool execution engine + integrations** (Gmail, Calendar, web, CRM, notes/files).
- **Kernel (perceive → decide → prioritize)** — this IS the reasoning loop; it gets
  re-scoped, not replaced.
- **Priority Queue / `set_priorities`** — the "recommend next" engine; re-key to objectives.
- **Approvals** (`needs_approval`, drafts, calendar suggestions) — the "decisions require me" spine.
- **Event Engine** — becomes an *advanced/implementation* capability; the OS uses it
  internally so the user never authors rules.
- **`/api/ops` aggregation** — already answers home questions 2–6; becomes the home-screen data source.
- **Conversation agent + voice** — the input surface for stating/steering objectives.
- **Memory/brain** — the knowledge substrate.

## 2. Components that must CHANGE

- **Add `Objective`** entity (title e.g. "Grow Prism44", description, status
  active/paused/done, priority, `state` = evolving OS-maintained summary, `lastReviewedAt`).
- **Link work to objectives**: `mission.objectiveId`, `priority.objectiveId`.
- **Kernel → Objective Planner**: for each active objective, reason about *what needs
  to happen, what's in progress, what changed, which missions to create / pause /
  reprioritize, which tools, immediate vs approval*. Emits missions + priorities +
  decisions + an updated objective `state`.
- **Missions**: add `pause` and `reprioritize` (today only `cancel`/re-queue exist).
- **Continuous-improvement loop**: learn from approvals/declines/edits + mission outcomes
  to tune future proposals; track per-objective progress.

## 3. UI to REDESIGN

- **Home screen** → objective-first, answering only the 6 questions. Chat/voice stays
  as the way to state/steer an objective; it is not a separate "app."
- **Navigation / information architecture** → primary surface = Objectives + Decisions.
  Everything else moves under **Advanced / System**.
- **Command Center (`/ops`)** → its data feeds the home; its ops/health/worker framing
  becomes an advanced "System" view, not the front door.

## 4. Concepts that DISAPPEAR from the primary experience (remain as advanced)

- **Automations / rules** (Event Engine) — the OS decides its own triggers; the user
  never hand-builds rules in normal use.
- **Workflows / the Continuous Orchestrator** — a *builder-of-the-OS* tool, not a
  user-of-the-OS surface; removed from the product entirely (dev-only).
- **The module drawer** (CRM, Pipeline, Tasks, Mail, Calendar, Notes, Files) — these
  are *data the OS uses*, surfaced contextually under objectives, not a tool grid the
  user navigates.
- **"Mission Queue" as a manual create form** — missions emerge from objectives; manual
  creation survives only as an advanced shortcut. The user thinks in objectives, not missions.

## 5. Ordered transition milestones (non-destructive)

1. **Objectives spine (data).** `Objective` entity + `mission.objectiveId` /
   `priority.objectiveId` + CRUD API + "state an objective" from chat. Foundation only.
2. **Objective Reasoning (the planner).** Re-scope the kernel to per-objective planning:
   perceive → reason → create/pause/reprioritize missions, choose tools, split
   immediate-vs-approval, update objective `state` + the (objective-scoped) Priority
   Queue. Saying "Grow Prism44" runs it on demand.
3. **Objectives Home Screen.** New front door answering the 6 questions; chat/voice as
   input; module drawer + ops demoted to Advanced.
4. **Decisions & Approvals surface.** One frictionless inbox for every approval
   (drafts, calendar suggestions, gated missions, proposed actions).
5. **Continuous Improvement.** Per-objective periodic re-reasoning + learning from
   approvals/outcomes; objective progress tracking.
6. **Finalize Advanced IA.** Move automations/event-engine/orchestrator/system views
   behind "Advanced"; confirm the primary flow never requires them.

## Guardrails / preserved

- The execution substrate (missions, tools, worker, integrations, priorities, approvals,
  event engine) is the engine room — **reused, not rebuilt**.
- Safety unchanged: no autonomous outward/irreversible actions without approval.
- Loop/spend caps, dedup, exactly-once, and status logging carry straight over to
  objective-driven missions.

## Recommended first step

**Milestone 1 (Objectives spine)** — it unlocks everything else and touches no UX yet.
Then Milestone 2 (reasoning) makes "Grow Prism44" real, and Milestone 3 makes it the
front door.
