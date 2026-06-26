# 🧬 Evolution OS

**One intelligence you talk to from your phone that gets work done across all
your businesses, projects, and life.**

You open the app, you're in a conversation, you give a command, you get a
result. That's the whole experience. The system decides which capabilities to
use — creating a task, adding a contact, logging a deal, remembering a fact,
sending an email, booking a calendar event — and does it. Sensitive actions
pause for a one-tap approval.

> **One conversation, not many dashboards. One brain, many capabilities.**

## How it works
**Open phone → tap the mic → speak → it understands → it executes → it reports back.**

- **Voice-first.** A finished sentence is sent immediately — speak and it's done.
  A live transcript shows you're heard; the wave button starts hands-free mode.
- **It acts, not just answers.** Behind the scenes it calls *capabilities*
  (`lib/tools.ts`) that execute real work; you just see the result.
- **Approval flow.** Sending email or creating calendar events shows an
  Approve / Decline card before anything happens.
- **Persistent memory.** Facts, contacts, deals, tasks, notes and files persist
  and are fed back to the assistant in every conversation.

## Two modes (the system picks — you only state objectives)
- **Conversation Mode** — immediate responses, questions, guidance, and single
  actions. You speak, it answers or does the one thing, right now.
- **Mission Mode** — for a big or multi-step objective ("research X, summarize
  it, and save it"), Evolution starts a **mission** that runs on the server in
  the background: it plans, works step by step, **checks its own work** before
  reporting, pauses for approval when needed, and reports back when done.

## Persistent execution (the OS part)
Missions don't live in the browser — they run on the **backend** and persist:

- **Open phone → speak → leave → return later → results waiting.**
- A mission keeps running when the app is closed, when you leave, and when your
  phone is offline — execution happens on the server, not the page.
- Progress, results, and memory are stored on disk and **survive restarts**; a
  mission interrupted by a restart resumes automatically.
- Before reporting, a **quality-control pass** verifies the result against what
  was actually done and sends it back to revise if a claim isn't supported —
  Evolution won't tell you it did something it didn't.

Architecture: a file-backed store (`lib/server/db.ts`, swappable for Postgres),
a server tool layer (`lib/server/tools.ts`), the mission engine
(`lib/server/missionEngine.ts`), and a worker started on boot
(`instrumentation.ts`). The client only watches via `/api/missions`.

## One brain
Memory, tasks, contacts, deals, and notes live in a single server-side store
(`lib/server/data.ts`). Everything reads and writes the same brain:

- **Conversation actions** execute server-side via `/api/tools/[name]`.
- **Missions** call the same capabilities directly.
- **Module views** read/write through `/api/data/[kind]` (the `useCollection`
  hook; legacy browser data migrates up once, automatically).
- The **chat's knowledge** is built from the brain on every turn.

So a contact you add by voice shows up in the CRM, a task a mission creates
shows up in Tasks, and a fact saved anywhere is known everywhere — and it all
survives a restart. (Files remain in the browser for now.)

> **Not yet wired (next milestones, need a hosting/permission decision):**
> deploying to an always-on host for true 24/7 execution, and push
> notifications to a closed app. Today, results are waiting the moment you
> return while the server is running.

New capability domains — email, contacts, calendar, files, AI image & video
generation, social media, research, real-estate analysis, business operations —
plug in as more entries in `lib/tools.ts`. The conversation never changes.

## The modules (hidden behind one menu)
Tap the ☰ menu to open any capability directly — but you rarely need to. These
are the surfaces the intelligence operates on, not the primary experience:

| Module | What it holds |
|---|---|
| **Overview** | Everything at a glance |
| **Contacts** | People & leads (CRM) |
| **Deals** | Property pipeline |
| **Tasks**, **Notes** | To-dos and saved writing |
| **Memory** | What the assistant durably remembers |
| **Email**, **Calendar** | Gmail & Google Calendar (needs Google setup — see below) |
| **Files** | Documents, searchable & tagged |

New businesses plug in by adding capabilities in `lib/tools.ts` — the chat
experience never changes.

Built with **Next.js + TypeScript + Tailwind**, the **OpenAI API** (tool
calling), and optimized for **iPhone** (installable home-screen app).

> Your contacts, deals, tasks, notes, memory, files, and conversation are
> stored locally in your browser. Nothing is uploaded to a server (Gmail /
> Calendar are accessed live via secure server-side tokens).

---

## 🚀 Quick start (3 steps)

You only need to do this once. Open the **Terminal** app and run these commands.

### 1. Go into the project folder
```bash
cd ~/evolution-os
```
> Packages are already installed. You'd only re-run `npm install` if you move the folder to a new computer.

### 2. Add your OpenAI API key
1. Get a key at <https://platform.openai.com/api-keys> (it starts with `sk-`).
2. In the project folder, copy the example env file to a real one:
   ```bash
   cp .env.local.example .env.local
   ```
3. Open `.env.local` in any text editor and paste your key after `=`:
   ```
   OPENAI_API_KEY=sk-your-real-key-here
   ```
4. Save the file.

> 🔒 Your key lives only in `.env.local` on your computer. It is never sent to
> the browser and is ignored by git, so it can't leak.

### 3. Launch the assistant
```bash
npm run dev
```
Then open **<http://localhost:3000>** in Chrome.

That's it — go to **AI Chat** and start talking. 🎉

---

## 🎙️ Using voice
- **Speak to it:** click the microphone button in AI Chat and talk.
- **Hear replies:** voice replies are on by default (toggle in the top-right of chat).
- Voice uses your browser's built-in speech engine — works best in **Chrome**,
  and your browser will ask permission to use the microphone the first time.

## ✉️ Optional: connect Gmail & Calendar
Everything except the Gmail and Calendar pages works without this.
1. Go to the [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth client ID → Web application**, and enable the **Gmail API** + **Google Calendar API**.
3. Add the redirect URI: `http://localhost:3000/api/google/callback`
4. Put the client ID & secret in `.env.local` (see `.env.local.example`), then restart `npm run dev`.
5. Open **Settings → Google** and click **Connect Google account**.

## 📱 Install on your iPhone
Open the site in **Safari** → tap **Share** → **Add to Home Screen**. It launches
full-screen like a native app, with a bottom tab bar for one-thumb navigation.

## 🔑 Two ways to provide the key
- **Recommended:** `.env.local` file (step 2 above).
- **Alternative:** open the **Settings** page in the app and paste the key there
  (stored in your browser only). Use the **Test connection** button to confirm it works.

## 🧩 Common commands
| Command | What it does |
|---|---|
| `npm install` | Install everything (run once). |
| `npm run dev` | Start the app for daily use (http://localhost:3000). |
| `npm run build` | Make an optimized production build. |
| `npm start` | Run the production build. |

## ❓ Troubleshooting
- **"No OpenAI API key found"** → check `.env.local` has your key and **restart**
  `npm run dev` (env changes need a restart).
- **Mic does nothing** → use Chrome and allow microphone access.
- **Billing/quota error** → add a payment method / credits to your OpenAI account.
