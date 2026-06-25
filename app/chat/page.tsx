"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { uid } from "@/lib/store";
import { buildAssistantContext } from "@/lib/context";
import { useSpeechRecognition, speak, stopSpeaking } from "@/lib/voice";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const STARTER =
  "Hi! I'm your Evolution OS assistant. I know your leads, deals, tasks, and notes. Ask me anything — type it or tap the mic. Turn on hands-free mode for a full voice conversation.";

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: "intro", role: "assistant", content: STARTER },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Latest values for the speech callback (which is bound once at mount).
  const handsFreeRef = useRef(handsFree);
  const busyRef = useRef(busy);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const sendRef = useRef<(text: string) => void>(() => {});

  const { listening, supported, start, stop } = useSpeechRecognition((text) => {
    if (handsFreeRef.current) {
      if (!busyRef.current) sendRef.current(text);
    } else {
      setInput((prev) => (prev ? prev + " " + text : text));
    }
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busyRef.current) return;

    stopSpeaking();
    setError(null);
    setInput("");

    const userMsg: Msg = { id: uid(), role: "user", content };
    const assistantId = uid();
    const history = [...messages, userMsg];

    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setBusy(true);

    const savedKey =
      typeof window !== "undefined" ? window.localStorage.getItem("evo.openaiKey") || "" : "";
    const savedModel =
      typeof window !== "undefined" ? window.localStorage.getItem("evo.model") || "" : "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(savedKey ? { "x-openai-key": savedKey } : {}),
        },
        body: JSON.stringify({
          model: savedModel || undefined,
          context: buildAssistantContext(),
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m))
        );
      }

      if (voiceOn && full) {
        speak(full, () => {
          // In hands-free mode, resume listening once the reply finishes.
          if (handsFreeRef.current && supported) {
            try { start(); } catch { /* noop */ }
          }
        });
      }
    } catch (e: any) {
      const msg = e?.message || "Something went wrong.";
      setError(msg);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: "⚠️ " + msg } : m))
      );
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = send;

  function toggleHandsFree() {
    const next = !handsFree;
    setHandsFree(next);
    stopSpeaking();
    if (next && supported) {
      try { start(); } catch { /* noop */ }
    } else {
      stop();
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-9rem)] lg:h-[calc(100vh-4rem)]">
      <PageHeader
        title="AI Assistant"
        subtitle="Voice-first · knows your business"
        action={
          <button
            onClick={() => { setVoiceOn((v) => !v); stopSpeaking(); }}
            className={voiceOn ? "btn-primary" : "btn-ghost"}
            title="Read replies aloud"
          >
            {voiceOn ? "🔊" : "🔇"}
          </button>
        }
      />

      {/* Hands-free banner */}
      {handsFree && (
        <div className="mb-3 flex items-center gap-3 glass px-4 py-2.5 border-accent/30">
          <span className={`typing-dot ${listening ? "" : "opacity-30"}`} />
          <span className="text-sm text-slate-200">
            {busy ? "Thinking…" : listening ? "Listening — speak now" : "Hands-free on"}
          </span>
          <button onClick={toggleHandsFree} className="ml-auto text-xs text-accent hover:underline">
            Turn off
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto glass p-4 space-y-4">
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} />
        ))}
        {busy && messages[messages.length - 1]?.content === "" && (
          <div className="flex items-center gap-1.5 px-2">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 text-sm text-pink-300 bg-pink-500/10 border border-pink-500/30 rounded-xl px-4 py-2">
          {error} <a href="/settings" className="underline text-accent">Open Settings</a>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex items-end gap-2"
      >
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported}
          title={supported ? "Tap to speak" : "Voice input isn't supported in this browser"}
          className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border transition
            ${listening
              ? "bg-pink-500/20 border-pink-500/50 text-pink-300 animate-pulseGlow"
              : "bg-white/5 border-white/10 text-slate-300 hover:border-accent/40 disabled:opacity-30"}`}
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
          placeholder={listening ? "Listening… speak now" : "Message Evolution OS…"}
          className="input resize-none max-h-40 py-3"
        />

        <button
          type="button"
          onClick={toggleHandsFree}
          disabled={!supported}
          title="Hands-free voice conversation"
          className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border transition
            ${handsFree
              ? "bg-gradient-to-br from-accent to-accent2 text-void border-accent"
              : "bg-white/5 border-white/10 text-slate-300 hover:border-accent/40 disabled:opacity-30"}`}
        >
          <WaveIcon />
        </button>

        <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-12 px-5 shrink-0">
          {busy ? "…" : "Send"}
        </button>
      </form>
      <p className="text-[11px] text-slate-600 mt-2 text-center">
        Enter to send · Shift+Enter for new line · Tap the wave for hands-free voice mode
      </p>
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-floatUp`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-wrap leading-relaxed text-sm
          ${isUser
            ? "bg-gradient-to-br from-accent/25 to-accent2/25 border border-accent/30 text-white"
            : "bg-white/5 border border-white/10 text-slate-200"}`}
      >
        {!isUser && (
          <div className="text-[10px] uppercase tracking-widest text-accent mb-1">Evolution OS</div>
        )}
        {content}
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
