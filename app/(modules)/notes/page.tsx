"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { uid, formatDate, type Note } from "@/lib/store";
import { useCollection } from "@/lib/collection";

export default function NotesPage() {
  const [notes, setNotes, loaded] = useCollection<Note>("notes", []);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = notes.find((n) => n.id === activeId) || null;

  function create() {
    const note: Note = {
      id: uid(),
      title: "Untitled note",
      body: "",
      updatedAt: Date.now(),
    };
    setNotes([note, ...notes]);
    setActiveId(note.id);
  }

  function update(patch: Partial<Note>) {
    if (!active) return;
    setNotes(
      notes.map((n) =>
        n.id === active.id ? { ...n, ...patch, updatedAt: Date.now() } : n
      )
    );
  }

  function remove(id: string) {
    setNotes(notes.filter((n) => n.id !== id));
    if (activeId === id) setActiveId(null);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Notes"
        subtitle="Capture ideas instantly."
        action={
          <button className="btn-primary" onClick={create}>
            + New note
          </button>
        }
      />

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* List */}
        <div className="glass p-3 space-y-1.5 h-fit">
          {loaded && notes.length === 0 && (
            <p className="text-slate-500 text-sm p-4 text-center">
              No notes yet.
            </p>
          )}
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => setActiveId(n.id)}
              className={`w-full text-left rounded-xl px-3 py-2.5 border transition ${
                activeId === n.id
                  ? "bg-accent/10 border-accent/40"
                  : "border-transparent hover:bg-white/5"
              }`}
            >
              <div className="text-sm font-medium text-slate-100 truncate">
                {n.title || "Untitled"}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {n.body ? n.body.slice(0, 40) : "Empty"} · {formatDate(n.updatedAt)}
              </div>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="glass p-5 min-h-[420px]">
          {active ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2">
                <input
                  className="input !border-transparent !bg-transparent text-lg font-semibold px-0 focus:!ring-0"
                  value={active.title}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder="Note title"
                />
                <button
                  onClick={() => remove(active.id)}
                  className="btn-ghost !px-3 text-pink-300"
                >
                  Delete
                </button>
              </div>
              <textarea
                className="input flex-1 mt-3 resize-none min-h-[320px] leading-relaxed"
                value={active.body}
                onChange={(e) => update({ body: e.target.value })}
                placeholder="Start writing…"
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-center">
              Select a note on the left, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
