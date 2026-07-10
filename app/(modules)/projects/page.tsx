"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { uid, formatDate, type Project } from "@/lib/store";
import { useCollection } from "@/lib/collection";
import { useBrand } from "@/components/BrandContext";

const STATUS: Record<Project["status"], string> = {
  planning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  done: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export default function ProjectsPage() {
  const [allProjects, setProjects, loaded] = useCollection<Project>("projects", []);
  const { activeBrand, isParentActive } = useBrand();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // The parent (UW Equity) sees every project; a subsidiary sees only its own.
  const projects = useMemo(
    () => (isParentActive || !activeBrand ? allProjects : allProjects.filter((p) => p.brandId === activeBrand.id)),
    [allProjects, activeBrand, isParentActive]
  );

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const project: Project = {
      id: uid(),
      // New projects belong to the active brand (unless the portfolio parent is active).
      brandId: isParentActive ? null : activeBrand?.id ?? null,
      name: name.trim(),
      description: description.trim(),
      status: "planning",
      createdAt: Date.now(),
    };
    setProjects([project, ...allProjects]);
    setName("");
    setDescription("");
  }

  function cycleStatus(id: string) {
    const order: Project["status"][] = ["planning", "active", "done"];
    setProjects(
      allProjects.map((p) =>
        p.id === id
          ? { ...p, status: order[(order.indexOf(p.status) + 1) % order.length] }
          : p
      )
    );
  }

  function remove(id: string) {
    setProjects(allProjects.filter((p) => p.id !== id));
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Projects" subtitle="Plan and track your work." />

      <form onSubmit={add} className="glass p-5 mb-6 grid sm:grid-cols-[1fr_1.5fr_auto] gap-3">
        <input
          className="input"
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          placeholder="Short description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="btn-primary" type="submit">
          + Add
        </button>
      </form>

      {loaded && projects.length === 0 && (
        <Empty label="No projects yet. Create your first one above." />
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div key={p.id} className="card flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-white">{p.name}</h3>
              <button
                onClick={() => remove(p.id)}
                className="text-slate-500 hover:text-pink-400 text-sm"
                title="Delete"
              >
                ✕
              </button>
            </div>
            {p.description && (
              <p className="text-sm text-slate-400 mt-1 flex-1">{p.description}</p>
            )}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => cycleStatus(p.id)}
                className={`text-xs px-2.5 py-1 rounded-full border capitalize ${STATUS[p.status]}`}
                title="Click to change status"
              >
                {p.status}
              </button>
              <span className="text-[11px] text-slate-600">
                {formatDate(p.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="glass p-10 text-center text-slate-500">{label}</div>
  );
}
