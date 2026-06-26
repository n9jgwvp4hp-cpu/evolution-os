"use client";

import { useEffect, useRef, useState } from "react";
import { uid } from "@/lib/store";
import { buildAssistantContext } from "@/lib/context";
import { getTool, toolSchemas } from "@/lib/tools";
import { useSpeechRecognition, speak, stopSpeaking } from "@/lib/voice";
import { useServerMissions, approveMission } from "@/lib/missionsClient";
import MissionPanel from "@/components/MissionPanel";

function notify(title: string, body: string) {
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

/* ---- conversation model ---- */
type ApiMsg = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

type Item =
  | { id: string; kind: "msg"; role: "user" | "assistant"; content: string }
  | { id: string; kind: "action"; label: string; status: "running" | "done" | "error"; detail?: string }
  | {
      id: string;
      kind: "approval";
      tool: string;
      summary: string;
      status: "pending" | "approved" | "declined" | "done" | "error";
      detail?: string;
    };

const EXAMPLES = [
  "Add Maria Lopez as a buyer lead, 305-555-0110, budget 600k",
  "Remind me to follow up with the Brickell seller tomorrow",
  "Remember I only take listings above $750k",
];

const STORAGE = "evo.os.chat";

export default function EvolutionOS() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ApiMsg[]>([]);
  const approvals = useRef<Record<string, (ok: boolean) => void>>({});

  // Background missions (executed + persisted on the server; we just watch)
  const allMissions = useServerMissions();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const missions = allMissions.filter((m) => !dismissed.includes(m.id));
  const missionStatus = useRef<Record<string, string>>({});
  const seeded = useRef(false);

  // refs so the speech callback (bound once) sees current values
  const handsFreeRef = useRef(handsFree);
  const busyRef = useRef(busy);
  const sendRef = useRef<(t: string) => void>(() => {});
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Voice is the primary input: a finished utterance is sent immediately.
  // Speak → done. No extra tap.
  const { listening, supported, interim, start, stop } = useSpeechRecognition((text) => {
    if (!busyRef.current) sendRef.current(text);
  });

  // load persisted conversation + voice prefs once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.items)) setItems(saved.items);
        if (Array.isArray(saved.api)) apiRef.current = saved.api;
      }
      const v = localStorage.getItem("evo.os.voiceOn");
      if (v !== null) setVoiceOn(v === "1");
      const h = localStorage.getItem("evo.os.handsFree");
      if (h !== null) setHandsFree(h === "1");
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  // persist only when idle (guarantees a consistent tool/assistant history)
  useEffect(() => {
    if (!loaded || busy) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ items, api: apiRef.current }));
    } catch { /* ignore */ }
  }, [items, busy, loaded]);

  useEffect(() => {
    if (loaded) localStorage.setItem("evo.os.voiceOn", voiceOn ? "1" : "0");
  }, [voiceOn, loaded]);
  useEffect(() => {
    if (loaded) localStorage.setItem("evo.os.handsFree", handsFree ? "1" : "0");
  }, [handsFree, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy, interim]);

  const add = (item: Item) => setItems((p) => [...p, item]);
  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...p } as Item) : it)));

  // Mission lifecycle: report back in chat when one finishes.
  // (Execution + resume happen on the server; the client only reflects state.)
  useEffect(() => {
    if (!loaded) return;
    if (!seeded.current) {
      for (const m of missions) missionStatus.current[m.id] = m.status;
      seeded.current = true;
      return;
    }
    for (const m of missions) {
      const prev = missionStatus.current[m.id];
      if (prev === m.status) continue;
      missionStatus.current[m.id] = m.status;
      if (m.status === "done" && prev && prev !== "done") {
        const text = m.result || "Mission complete.";
        add({ id: uid(), kind: "msg", role: "assistant", content: "✅ " + text });
        notify("Evolution OS — mission complete", text.slice(0, 180));
        if (voiceOn) speak(text);
      } else if (m.status === "failed" && prev && prev !== "failed") {
        add({ id: uid(), kind: "msg", role: "assistant", content: "⚠️ Mission failed: " + (m.result || "") });
      }
    }
  }, [missions, loaded, voiceOn]);

  function requestApproval(tool: string, summary: string): Promise<{ ok: boolean; id: string }> {
    const id = uid();
    add({ id, kind: "approval", tool, summary, status: "pending" });
    return new Promise((resolve) => {
      approvals.current[id] = (ok) => resolve({ ok, id });
    });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busyRef.current) return;

    stopSpeaking();
    setError(null);
    setInput("");
    // Ask once so completed missions can notify even if the app is backgrounded.
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch { /* ignore */ }
    add({ id: uid(), kind: "msg", role: "user", content });
    apiRef.current.push({ role: "user", content });
    setBusy(true);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const savedKey = localStorage.getItem("evo.openaiKey") || "";
    const savedModel = localStorage.getItem("evo.model") || "";
    if (savedKey) headers["x-openai-key"] = savedKey;

    try {
      let finalText = "";
      for (let step = 0; step < 8; step++) {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: apiRef.current,
            tools: toolSchemas(),
            context: buildAssistantContext(),
            model: savedModel || undefined,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Request failed (${res.status}).`);
        }
        const { message } = await res.json();
        const calls: any[] = message.tool_calls || [];
        apiRef.current.push({
          role: "assistant",
          content: message.content ?? "",
          tool_calls: calls.length ? calls : undefined,
        });

        if (message.content && message.content.trim()) {
          add({ id: uid(), kind: "msg", role: "assistant", content: message.content.trim() });
          finalText = message.content.trim();
        }

        if (!calls.length) break;

        // execute each requested capability
        for (const call of calls) {
          const name = call.function?.name as string;
          let args: any = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* ignore */ }
          const tool = getTool(name);

          let result: any;
          if (!tool) {
            result = { ok: false, error: "Unknown capability." };
          } else if (tool.requiresApproval) {
            const { ok, id } = await requestApproval(name, tool.summarize(args));
            if (!ok) {
              patch(id, { status: "declined" });
              result = { ok: false, declined: true };
            } else {
              patch(id, { status: "approved" });
              try {
                result = await tool.execute(args);
                patch(id, {
                  status: result.ok === false ? "error" : "done",
                  detail: result.ok === false ? String(result.error || "Failed") : undefined,
                });
              } catch (e: any) {
                result = { ok: false, error: e?.message || "Failed" };
                patch(id, { status: "error", detail: result.error });
              }
            }
          } else {
            const id = uid();
            add({ id, kind: "action", label: tool.summarize(args), status: "running" });
            try {
              result = await tool.execute(args);
              patch(id, {
                status: result.ok === false ? "error" : "done",
                detail: result.ok === false ? String(result.error || "Failed") : undefined,
              });
            } catch (e: any) {
              result = { ok: false, error: e?.message || "Failed" };
              patch(id, { status: "error", detail: result.error });
            }
          }

          apiRef.current.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }

      if (voiceOn && finalText) {
        speak(finalText, () => {
          if (handsFreeRef.current && supported) { try { start(); } catch { /* noop */ } }
        });
      }
    } catch (e: any) {
      const msg = e?.message || "Something went wrong.";
      setError(msg);
      add({ id: uid(), kind: "msg", role: "assistant", content: "⚠️ " + msg });
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = send;

  function resolveApproval(id: string, ok: boolean) {
    approvals.current[id]?.(ok);
    delete approvals.current[id];
  }

  function toggleHandsFree() {
    const next = !handsFree;
    setHandsFree(next);
    stopSpeaking();
    if (next && supported) { try { start(); } catch { /* noop */ } }
    else stop();
  }

  function newChat() {
    stopSpeaking();
    apiRef.current = [];
    setItems([]);
    setError(null);
    try { localStorage.removeItem(STORAGE); } catch { /* ignore */ }
  }

  const empty = items.length === 0;
  const micActive = listening;

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 flex flex-col">
      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <MissionPanel
            missions={missions}
            onApprove={approveMission}
            onDismiss={(id) => setDismissed((d) => [...d, id])}
          />
          {empty ? (
            <Hero
              listening={micActive}
              interim={interim}
              supported={supported}
              onTalk={micActive ? stop : start}
              onPick={send}
            />
          ) : (
            <div className="space-y-3">
              {items.map((it) =>
                it.kind === "msg" ? (
                  <Bubble key={it.id} role={it.role} content={it.content} />
                ) : it.kind === "action" ? (
                  <ActionChip key={it.id} label={it.label} status={it.status} detail={it.detail} />
                ) : (
                  <ApprovalCard key={it.id} item={it} onDecide={resolveApproval} />
                )
              )}
              {busy && (
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="text-xs text-slate-500 ml-1">working…</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="max-w-2xl mx-auto w-full px-4">
          <div className="text-sm text-pink-300 bg-pink-500/10 border border-pink-500/30 rounded-xl px-4 py-2">
            {error} <a href="/settings" className="underline text-accent">Settings</a>
          </div>
        </div>
      )}

      {/* live listening caption (when not on the hero) */}
      {!empty && micActive && (
        <div className="max-w-2xl mx-auto w-full px-4 pb-1">
          <div className="flex items-center gap-2 text-sm text-accent">
            <span className="typing-dot" />
            <span className="truncate">{interim || "Listening…"}</span>
          </div>
        </div>
      )}

      {/* composer */}
      <div className="border-t border-white/10 bg-void/70 backdrop-blur-xl pb-safe">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="max-w-2xl mx-auto w-full px-3 pt-2.5 pb-2 flex items-end gap-2"
        >
          <button
            type="button"
            onClick={micActive ? stop : start}
            disabled={!supported}
            title={supported ? "Tap and speak" : "Voice input not supported in this browser"}
            className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border transition
              ${micActive
                ? "bg-pink-500/20 border-pink-500/50 text-pink-300 animate-pulseGlow"
                : "bg-gradient-to-br from-accent to-accent2 text-void border-accent shadow-glow disabled:opacity-30 disabled:bg-none disabled:text-slate-400"}`}
          >
            <MicIcon />
          </button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            rows={1}
            placeholder={micActive ? "Listening…" : "Speak, or type…"}
            className="input resize-none max-h-40 py-2.5 text-base"
          />

          <button
            type="button"
            onClick={toggleHandsFree}
            disabled={!supported}
            title="Hands-free conversation mode"
            className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center border transition
              ${handsFree
                ? "bg-gradient-to-br from-accent2 to-accent3 text-void border-accent2"
                : "bg-white/5 border-white/10 text-slate-300 hover:border-accent/40 disabled:opacity-30"}`}
          >
            <WaveIcon />
          </button>

          {input.trim() && (
            <button type="submit" disabled={busy} className="btn-primary h-12 w-12 !px-0 shrink-0">
              <SendIcon />
            </button>
          )}
        </form>
        <div className="max-w-2xl mx-auto w-full px-4 pb-2 flex items-center justify-between text-[11px] text-slate-600">
          <button onClick={() => { setVoiceOn((v) => !v); stopSpeaking(); }} className="hover:text-slate-300">
            {voiceOn ? "🔊 Spoken replies on" : "🔇 Spoken replies off"}
          </button>
          {!empty && <button onClick={newChat} className="hover:text-slate-300">New chat</button>}
        </div>
      </div>
    </div>
  );
}

function Hero({
  listening, interim, supported, onTalk, onPick,
}: {
  listening: boolean;
  interim: string;
  supported: boolean;
  onTalk: () => void;
  onPick: (t: string) => void;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-8 pb-4">
      <h1 className="text-2xl font-bold gradient-text">Evolution OS</h1>
      <p className="text-slate-400 mt-2 max-w-sm">
        Tap, speak your objective, and it gets done.
      </p>

      {/* primary talk affordance */}
      <button
        onClick={onTalk}
        disabled={!supported}
        className="relative mt-8 mb-3 w-32 h-32 rounded-full flex items-center justify-center
          bg-gradient-to-br from-accent to-accent2 text-void shadow-glow
          transition active:scale-95 disabled:opacity-40"
      >
        {listening && (
          <>
            <span className="absolute inset-0 rounded-full bg-accent/40 animate-ping" />
            <span className="absolute -inset-2 rounded-full border border-accent/40 animate-pulseGlow" />
          </>
        )}
        <span className="relative scale-[2.2]"><MicIcon /></span>
      </button>

      <div className="h-7 text-sm">
        {!supported ? (
          <span className="text-slate-500">Voice isn&apos;t supported here — type below.</span>
        ) : listening ? (
          <span className="text-accent">{interim || "Listening… speak now"}</span>
        ) : (
          <span className="text-slate-500">Tap to speak</span>
        )}
      </div>

      <div className="mt-7 w-full space-y-2">
        <p className="text-[11px] uppercase tracking-widest text-slate-600 mb-2">Try saying</p>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => onPick(ex)}
            className="w-full text-left text-sm rounded-2xl px-4 py-3 bg-white/5 border border-white/10
              hover:border-accent/40 hover:bg-white/10 transition text-slate-200"
          >
            “{ex}”
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-floatUp`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap leading-relaxed text-[15px]
          ${isUser
            ? "bg-gradient-to-br from-accent/25 to-accent2/25 border border-accent/30 text-white"
            : "bg-white/5 border border-white/10 text-slate-100"}`}
      >
        {content}
      </div>
    </div>
  );
}

function ActionChip({
  label, status, detail,
}: { label: string; status: "running" | "done" | "error"; detail?: string }) {
  const icon = status === "running" ? "◌" : status === "done" ? "✓" : "✕";
  const tone =
    status === "error"
      ? "text-pink-300 border-pink-500/30"
      : status === "done"
      ? "text-emerald-300 border-emerald-500/30"
      : "text-slate-400 border-white/10";
  return (
    <div className="flex justify-start animate-floatUp">
      <div className={`inline-flex items-center gap-2 text-xs rounded-full border px-3 py-1.5 bg-black/20 ${tone}`}>
        <span className={status === "running" ? "animate-pulseGlow" : ""}>{icon}</span>
        <span>{label}</span>
        {detail && <span className="text-pink-300/80">· {detail}</span>}
      </div>
    </div>
  );
}

function ApprovalCard({
  item, onDecide,
}: {
  item: Extract<Item, { kind: "approval" }>;
  onDecide: (id: string, ok: boolean) => void;
}) {
  const decided = item.status !== "pending";
  return (
    <div className="flex justify-start animate-floatUp">
      <div className="max-w-[88%] w-full rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <div className="flex items-center gap-2 text-amber-300 text-xs font-medium uppercase tracking-wide">
          <span>🔐</span> Approval needed
        </div>
        <p className="text-slate-100 text-sm mt-1.5">{item.summary}</p>

        {!decided ? (
          <div className="flex gap-2 mt-3">
            <button onClick={() => onDecide(item.id, true)} className="btn-primary !py-1.5 text-sm flex-1">
              Approve
            </button>
            <button onClick={() => onDecide(item.id, false)} className="btn-ghost !py-1.5 text-sm flex-1">
              Decline
            </button>
          </div>
        ) : (
          <div className="mt-2 text-xs">
            {item.status === "declined" && <span className="text-slate-400">Declined.</span>}
            {item.status === "approved" && <span className="text-slate-400">Approved — running…</span>}
            {item.status === "done" && <span className="text-emerald-300">✓ Done.</span>}
            {item.status === "error" && <span className="text-pink-300">✕ {item.detail || "Failed."}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}
function WaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 12h2M8 8v8M12 4v16M16 8v8M19 12h2" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}
