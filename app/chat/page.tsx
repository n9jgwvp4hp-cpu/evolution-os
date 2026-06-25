"use client";

import { useEffect, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { uid } from "@/lib/store";
import {
  useSpeechRecognition,
  speak,
  stopSpeaking,
} from "@/lib/voice";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const STARTER = "Hi! I'm your Evolution OS assistant. Ask me anything — type it or tap the mic to speak.";

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: "intro", role: "assistant", content: STARTER },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice input: when speech is recognized, drop it into the input box.
  const { listening, supported, start, stop } = useSpeechRecognition((text) => {
    setInput((prev) => (prev ? prev + " " + text : text));
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    stopSpeaking();
    setError(null);
    setInput("");

    const userMsg: Msg = { id: uid(), role: "user", content };
    const assistantId = uid();
    const history = [...messages, userMsg];

    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setBusy(true);

    // A key saved on the Settings page (optional fallback to .env.local).
    const savedKey =
      typeof window !== "undefined"
        ? window.localStorage.getItem("evo.openaiKey") || ""
        : "";
    const savedModel =
      typeof window !== "undefined"
        ? window.localStorage.getItem("evo.model") || ""
        : "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(savedKey ? { "x-openai-key": savedKey } : {}),
        },
        body: JSON.stringify({
          model: savedModel || undefined,
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

      if (voiceOn && full) speak(full);
    } catch (e: any) {
      const msg = e?.message || "Something went wrong.";
      setError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "⚠️ " + msg }
            : m
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-7rem)] lg:h-[calc(100vh-4rem)]">
      <PageHeader
        title="AI Chat"
        subtitle="Powered by OpenAI · voice in & out"
        action={
          <button
            onClick={() => {
              setVoiceOn((v) => !v);
              stopSpeaking();
            }}
            className={voiceOn ? "btn-primary" : "btn-ghost"}
          >
            {voiceOn ? "🔊 Voice replies on" : "🔇 Voice replies off"}
          </button>
        }
      />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto glass p-4 space-y-4"
      >
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
          {error}{" "}
          <a href="/settings" className="underline text-accent">
            Open Settings
          </a>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-end gap-2"
      >
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported}
          title={
            supported
              ? "Tap to speak"
              : "Voice input isn't supported in this browser"
          }
          className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border transition
            ${
              listening
                ? "bg-pink-500/20 border-pink-500/50 text-pink-300 animate-pulseGlow"
                : "bg-white/5 border-white/10 text-slate-300 hover:border-accent/40 disabled:opacity-30"
            }`}
        >
          <MicIcon />
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder={
            listening ? "Listening… speak now" : "Message Evolution OS…"
          }
          className="input resize-none max-h-40 py-3"
        />

        <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-12 px-5 shrink-0">
          {busy ? "…" : "Send"}
        </button>
      </form>
      <p className="text-[11px] text-slate-600 mt-2 text-center">
        Press Enter to send · Shift+Enter for a new line · Mic uses your
        browser&apos;s speech recognition
      </p>
    </div>
  );
}

function Bubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-floatUp`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-wrap leading-relaxed text-sm
          ${
            isUser
              ? "bg-gradient-to-br from-accent/25 to-accent2/25 border border-accent/30 text-white"
              : "bg-white/5 border border-white/10 text-slate-200"
          }`}
      >
        {!isUser && (
          <div className="text-[10px] uppercase tracking-widest text-accent mb-1">
            Evolution OS
          </div>
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
