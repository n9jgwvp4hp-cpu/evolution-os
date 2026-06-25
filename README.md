# 🧬 Evolution OS

Your personal **real-estate AI assistant** — voice-first chat that knows your
business, a leads CRM, a property-deal pipeline, long-term memory, Gmail &
Google Calendar, tasks, notes, and searchable file storage. Built with
**Next.js + TypeScript + Tailwind**, connected to the **OpenAI API**, and
optimized for **iPhone** (installable as a home-screen app).

## ✨ What's inside
| Feature | Where | Notes |
|---|---|---|
| 🎙️ Voice-first assistant | **AI Assistant** | Type or talk; tap the wave icon for hands-free conversation. Knows your CRM, deals, tasks & notes. |
| 🧠 Long-term memory | **Memory** | Facts you save are auto-injected into every chat. |
| 👥 CRM for leads | **CRM · Leads** | Buyers/sellers/investors with status, budget, source; tap-to-call/text/email. |
| 🏠 Property pipeline | **Pipeline** | Kanban of deals from lead → close, with pipeline value & commission totals. |
| ✅ Tasks · 📝 Notes | **Tasks / Notes** | Quick capture with priorities. |
| ✉️ Gmail · 📅 Calendar | **Gmail / Calendar** | Read & send mail, view & create events (needs Google setup — see below). |
| 📁 File search & upload | **Files** | Drag-drop, tag, and search files stored in your browser. |
| 📱 Mobile / iPhone | everywhere | Bottom tab bar, safe-area aware, add to Home Screen. |

> Your CRM, deals, tasks, notes, memory, and files are stored locally in your
> browser. Nothing is uploaded to a server (Gmail/Calendar are accessed live
> via secure server-side tokens).

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
