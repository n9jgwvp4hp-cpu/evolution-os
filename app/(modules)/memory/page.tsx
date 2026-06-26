"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { uid, timeAgo, type Memory } from "@/lib/store";
import { useCollection } from "@/lib/collection";

const CATEGORIES: Memory["category"][] = [
  "personal",
  "business",
  "preference",
  "fact",
  "other",
];

const CAT_STYLE: Record<Memory["category"], string> = {
  personal: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  business: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  preference: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  fact: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  other: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export default function MemoryPage() {
  const [memories, setMemories, loaded] = useCollection<Memory>("memories", []);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<Memory["category"]>("fact");
  const [query, setQuery] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setMemories([
      { id: uid(), text: text.trim(), category, pinned: false, createdAt: Date.now() },
      ...memories,
    ]);
    setText("");
  }
  const togglePin = (id: string) =>
    setMemories(memories.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)));
  const remove = (id: string) => setMemories(memories.filter((m) => m.id !== id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...memories]
      .filter((m) => (q ? m.text.toLowerCase().includes(q) : true))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  }, [memories, query]);

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Long-term Memory"
        subtitle="Facts your assistant always remembers across every conversation."
      />

      <div className="glass p-4 mb-5 text-sm text-slate-400">
        💡 Anything you save here is automatically fed to your AI assistant in chat,
        so it knows your preferences, your business, and the people you work with.
      </div>

      <form onSubmit={add} className="glass p-5 mb-5 space-y-3">
        <textarea
          className="input resize-none min-h-[80px]"
          placeholder="e.g. I focus on luxury condos in downtown Miami. My commission split is 70/30."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <select className="input w-auto" value={category}
            onChange={(e) => setCategory(e.target.value as Memory["category"])}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-primary" type="submit">Remember this</button>
        </div>
      </form>

      <input
        className="input mb-4"
        placeholder="Search memories…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {loaded && visible.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">
          {query ? "No memories match." : "No memories yet. Teach your assistant something above."}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((m) => (
          <div key={m.id} className="glass px-4 py-3 flex items-start gap-3 group">
            <button
              onClick={() => togglePin(m.id)}
              title={m.pinned ? "Unpin" : "Pin"}
              className={`mt-0.5 ${m.pinned ? "text-accent" : "text-slate-600 hover:text-slate-300"}`}
            >
              {m.pinned ? "★" : "☆"}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-slate-100 text-sm leading-relaxed">{m.text}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${CAT_STYLE[m.category]}`}>
                  {m.category}
                </span>
                <span className="text-[10px] text-slate-600">{timeAgo(m.createdAt)}</span>
              </div>
            </div>
            <button
              onClick={() => remove(m.id)}
              className="text-slate-600 hover:text-pink-400 opacity-0 group-hover:opacity-100 transition"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
