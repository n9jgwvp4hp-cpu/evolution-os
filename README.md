# 🧬 Evolution OS

Your personal AI assistant dashboard — chat (with voice in & out), projects,
notes, tasks, files, and settings. Built with **Next.js + TypeScript + Tailwind**
and connected to the **OpenAI API**.

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
