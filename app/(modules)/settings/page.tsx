"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { speak } from "@/lib/voice";
import GoogleSettings from "@/components/GoogleSettings";

const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini — fast & cheap (recommended)" },
  { id: "gpt-4o", label: "GPT-4o — most capable" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo — lowest cost" },
];

export default function SettingsPage() {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setKey(localStorage.getItem("evo.openaiKey") || "");
    setModel(localStorage.getItem("evo.model") || "gpt-4o-mini");
  }, []);

  function save() {
    if (key.trim()) localStorage.setItem("evo.openaiKey", key.trim());
    else localStorage.removeItem("evo.openaiKey");
    localStorage.setItem("evo.model", model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key.trim() ? { "x-openai-key": key.trim() } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Say 'Evolution OS is online' and nothing else." }],
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      const text = await res.text();
      setTest("✅ Connected! Assistant replied: " + text.trim());
    } catch (e: any) {
      setTest("❌ " + (e?.message || "Connection failed."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Settings" subtitle="Connect OpenAI and tune your assistant." />

      <div className="glass p-6 space-y-6">
        {/* API key */}
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-2">
            OpenAI API Key
          </label>
          <input
            type="password"
            className="input font-mono"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Recommended: put your key in the <code className="text-accent">.env.local</code> file
            instead (more secure — see the README). A key saved here is stored
            only in this browser and used as a fallback.{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Get a key →
            </a>
          </p>
        </div>

        {/* Model */}
        <div>
          <label className="block text-sm font-medium text-slate-200 mb-2">
            Model
          </label>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={save}>
            {saved ? "✓ Saved" : "Save settings"}
          </button>
          <button
            className="btn-ghost"
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => speak("Voice output is working. Hello from Evolution OS.")}
          >
            🔊 Test voice
          </button>
        </div>

        {test && (
          <div className="text-sm rounded-xl px-4 py-3 bg-black/30 border border-white/10 text-slate-200">
            {test}
          </div>
        )}
      </div>

      {/* Google integration */}
      <div className="mt-4">
        <GoogleSettings />
      </div>

      <div className="glass p-6 mt-4 text-sm text-slate-400 space-y-2">
        <h3 className="text-white font-semibold">About your data</h3>
        <p>
          Your CRM leads, deals, tasks, notes, memory, and files are stored
          locally in your browser (localStorage) — nothing is uploaded to a
          server. Google email &amp; calendar are accessed live via secure,
          server-side tokens. Clearing your browser data will erase the local
          items.
        </p>
      </div>
    </div>
  );
}
