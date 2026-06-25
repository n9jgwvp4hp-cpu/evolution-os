"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useLocalStorage, uid, type Task } from "@/lib/store";

const PRIORITY: Record<Task["priority"], string> = {
  low: "text-slate-400 border-slate-500/30",
  medium: "text-amber-300 border-amber-500/30",
  high: "text-pink-300 border-pink-500/30",
};

export default function TasksPage() {
  const [tasks, setTasks, loaded] = useLocalStorage<Task[]>("evo.tasks", []);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setTasks([
      { id: uid(), title: title.trim(), done: false, priority, createdAt: Date.now() },
      ...tasks,
    ]);
    setTitle("");
  }

  const toggle = (id: string) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTasks(tasks.filter((t) => t.id !== id));

  const visible = tasks.filter((t) =>
    filter === "all" ? true : filter === "open" ? !t.done : t.done
  );
  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Tasks"
        subtitle={`${remaining} open of ${tasks.length} total`}
      />

      <form onSubmit={add} className="glass p-5 mb-5 flex flex-wrap gap-3">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="What needs to get done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className="input w-auto"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Task["priority"])}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button className="btn-primary" type="submit">
          + Add
        </button>
      </form>

      <div className="flex gap-2 mb-4">
        {(["all", "open", "done"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-3 py-1.5 rounded-lg border capitalize transition ${
              filter === f
                ? "bg-accent/15 border-accent/40 text-accent"
                : "border-white/10 text-slate-400 hover:text-white"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loaded && visible.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">
          Nothing here yet.
        </div>
      )}

      <div className="space-y-2">
        {visible.map((t) => (
          <div
            key={t.id}
            className="glass px-4 py-3 flex items-center gap-3 group"
          >
            <button
              onClick={() => toggle(t.id)}
              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                t.done
                  ? "bg-accent border-accent text-void"
                  : "border-slate-500 hover:border-accent"
              }`}
            >
              {t.done && "✓"}
            </button>
            <span
              className={`flex-1 ${
                t.done ? "line-through text-slate-500" : "text-slate-100"
              }`}
            >
              {t.title}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${PRIORITY[t.priority]}`}
            >
              {t.priority}
            </span>
            <button
              onClick={() => remove(t.id)}
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
