"use client";

/**
 * Global, persistent VOICE INTERFACE — available on every page of the app.
 *
 * A floating mic that turns spoken commands into real work: it feeds the
 * transcript to the same tool-aware agent the chat uses (/api/agent + the
 * client capability registry), so voice can create missions, query memory,
 * draft/send email (gated), manage calendar (gated), and run the CRM — then
 * speaks a natural summary of what it did. Conversation context is preserved
 * across turns. Two modes: push-to-talk and hands-free WAKE mode ("Evolution …").
 *
 * Mobile Safari / iPhone: audio output is unlocked on the first tap (iOS blocks
 * speechSynthesis until a user gesture), and recognition is auto re-armed after
 * each utterance (iOS ends recognition per result), so hands-free keeps working.
 *
 * Hidden on "/" — the root chat screen already has its own full voice loop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSpeechRecognition, speak, stopSpeaking } from "@/lib/voice";
import { toolSchemas, getTool } from "@/lib/tools";

type ApiMsg = { role: "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string };
const WAKE_WORDS = ["evolution", "hey evolution", "computer"];

export default function VoiceAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [wake, setWake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [approval, setApproval] = useState<null | { summary: string; resolve: (ok: boolean) => void }>(null);

  // Refs so the (once-bound) recognition callback always sees current values.
  const messagesRef = useRef<ApiMsg[]>([]); // conversation context — preserved across turns
  const wakeRef = useRef(false);
  const armedRef = useRef(false);
  const busyRef = useRef(false);
  const approvalRef = useRef(false);
  const audioUnlocked = useRef(false);
  useEffect(() => { wakeRef.current = wake; }, [wake]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { approvalRef.current = !!approval; }, [approval]);

  // ---- iOS: unlock speech synthesis on the first user gesture ----
  const unlockAudio = useCallback(() => {
    if (audioUnlocked.current) return;
    audioUnlocked.current = true;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* noop */ }
  }, []);

  // ---- the agent loop: transcript -> tools -> spoken summary (context kept) ----
  const requestApproval = useCallback((summary: string) =>
    new Promise<boolean>((resolve) => setApproval({ summary, resolve: (ok) => { setApproval(null); resolve(ok); } })), []);

  const runAgent = useCallback(async (text: string) => {
    setBusy(true); busyRef.current = true;
    setTranscript(text); setResponse(""); setOpen(true);
    messagesRef.current.push({ role: "user", content: text });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const k = localStorage.getItem("evo.openaiKey"); if (k) headers["x-openai-key"] = k;
    } catch { /* ignore */ }
    let finalText = "";
    try {
      for (let step = 0; step < 8; step++) {
        const res = await fetch("/api/agent", { method: "POST", headers, body: JSON.stringify({ messages: messagesRef.current, tools: toolSchemas() }) });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Request failed (${res.status})`); }
        const { message } = await res.json();
        const calls: any[] = message.tool_calls || [];
        messagesRef.current.push({ role: "assistant", content: message.content ?? "", tool_calls: calls.length ? calls : undefined });
        if (message.content && message.content.trim()) finalText = message.content.trim();
        if (!calls.length) break;
        for (const call of calls) {
          const name = call.function?.name as string;
          let args: any = {}; try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* ignore */ }
          const tool = getTool(name);
          let result: any;
          if (!tool) result = { ok: false, error: "Unknown capability." };
          else if (tool.requiresApproval) {
            // SAFETY: sensitive/irreversible actions (send email, create event) require explicit approval.
            const ok = await requestApproval(tool.summarize(args));
            result = ok ? await tool.execute(args).catch((e: any) => ({ ok: false, error: e?.message })) : { ok: false, declined: true };
          } else {
            result = await tool.execute(args).catch((e: any) => ({ ok: false, error: e?.message }));
          }
          messagesRef.current.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      const say = finalText || "Done.";
      setResponse(say);
      speak(say); // spoken, natural summary of what was done
    } catch (e: any) {
      const msg = "Sorry — " + (e?.message || "something went wrong.");
      setResponse(msg); speak(msg);
    } finally { setBusy(false); busyRef.current = false; }
  }, [requestApproval]);

  // ---- what to do with a finished utterance ----
  const handleUtterance = useCallback((text: string) => {
    if (busyRef.current || approvalRef.current) return;
    const lower = text.toLowerCase();
    if (wakeRef.current && !armedRef.current) {
      // hands-free: require the wake word before acting
      const w = WAKE_WORDS.find((x) => lower.includes(x));
      if (!w) return; // ignore ambient speech
      const after = text.slice(lower.indexOf(w) + w.length).replace(/^[,.!?\s]+/, "").trim();
      if (after) { runAgent(after); }
      else { armedRef.current = true; setResponse("Listening…"); setOpen(true); }
      return;
    }
    if (armedRef.current) armedRef.current = false; // consumed the wake, this is the command
    runAgent(text);
  }, [runAgent]);

  const { listening, supported, interim, start, stop } = useSpeechRecognition(handleUtterance);

  // ---- WAKE mode: keep recognition alive by re-arming after each utterance (iOS-safe) ----
  useEffect(() => {
    if (!wake || !supported || listening || busy || approval) return;
    const t = setTimeout(() => { try { start(); } catch { /* noop */ } }, 500);
    return () => clearTimeout(t);
  }, [wake, supported, listening, busy, approval, start]);

  if (pathname === "/") return null; // root chat has its own voice
  if (!supported) return null; // browser without Web Speech API

  const active = listening || busy;
  const toggleWake = () => { unlockAudio(); setWake((v) => { const n = !v; wakeRef.current = n; armedRef.current = false; if (!n) stop(); return n; }); setOpen(true); };
  const pushToTalk = () => { unlockAudio(); if (listening) { stop(); } else { setOpen(true); start(); } };

  return (
    <>
      {/* compact panel */}
      {open && (
        <div className="fixed bottom-24 right-4 z-50 w-[min(92vw,360px)] rounded-2xl border border-white/10 bg-[#0b0d1a]/95 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Voice{wake ? " · hands-free" : ""}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white" aria-label="Close voice panel">✕</button>
          </div>
          <div className="min-h-[1.25rem] text-slate-400">{interim ? <em>“{interim}”</em> : transcript ? <>You: “{transcript}”</> : wake ? <>Say “Evolution …”</> : <>Tap the mic and speak</>}</div>
          {(busy || response) && (
            <div className="mt-2 rounded-lg bg-white/5 p-2 text-slate-100">{busy ? "Working…" : response}</div>
          )}
          {approval && (
            <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2">
              <div className="mb-2 text-amber-200">Approve: {approval.summary}?</div>
              <div className="flex gap-2">
                <button onClick={() => approval.resolve(true)} className="rounded-md bg-emerald-500/90 px-3 py-1 text-white">Approve</button>
                <button onClick={() => approval.resolve(false)} className="rounded-md bg-white/10 px-3 py-1">Decline</button>
              </div>
            </div>
          )}
          <button onClick={toggleWake} className={`mt-3 w-full rounded-lg px-3 py-1.5 text-xs ${wake ? "bg-indigo-500/80 text-white" : "bg-white/10 text-slate-300"}`}>
            {wake ? "Hands-free ON — say “Evolution …”" : "Enable hands-free wake mode"}
          </button>
        </div>
      )}

      {/* floating push-to-talk mic (persistent, every page) */}
      <button
        onClick={pushToTalk}
        aria-label={listening ? "Stop listening" : "Push to talk"}
        className={`fixed bottom-5 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition
          ${active ? "bg-rose-500 animate-pulse" : "bg-indigo-500 hover:bg-indigo-400"} text-white`}
      >
        {/* mic glyph */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" />
        </svg>
      </button>
    </>
  );
}
