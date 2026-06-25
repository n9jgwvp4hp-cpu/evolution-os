"use client";

import { useMemo, useRef, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useLocalStorage, uid, formatDate, type StoredFile } from "@/lib/store";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — localStorage is small, keep files modest.

export default function FilesPage() {
  const [files, setFiles, loaded] = useLocalStorage<StoredFile[]>("evo.files", []);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) =>
      [f.name, f.type, f.tags || ""].join(" ").toLowerCase().includes(q)
    );
  }, [files, query]);

  function onPick(list: FileList | null) {
    if (!list) return;
    setError(null);
    Array.from(list).forEach((file) => {
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is larger than 2 MB and was skipped.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const stored: StoredFile = {
          id: uid(),
          name: file.name,
          type: file.type || "file",
          size: file.size,
          dataUrl: String(reader.result),
          createdAt: Date.now(),
        };
        setFiles((prev) => [stored, ...prev]);
      };
      reader.readAsDataURL(file);
    });
  }

  const remove = (id: string) => setFiles(files.filter((f) => f.id !== id));
  const setTags = (id: string, tags: string) =>
    setFiles(files.map((f) => (f.id === id ? { ...f, tags } : f)));

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Files"
        subtitle={`${files.length} stored locally · searchable`}
      />

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onPick(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className="glass border-dashed border-2 border-white/15 hover:border-accent/40 p-10 text-center cursor-pointer transition mb-6"
      >
        <div className="text-4xl mb-2">⬆️</div>
        <p className="text-slate-300 font-medium">
          Click to upload or drag &amp; drop files here
        </p>
        <p className="text-slate-500 text-sm mt-1">Up to 2 MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
      </div>

      {error && (
        <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2 mb-4">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <input
          className="input mb-4"
          placeholder="Search files by name, type, or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {loaded && files.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">
          No files stored yet.
        </div>
      )}
      {loaded && files.length > 0 && visible.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">
          No files match &ldquo;{query}&rdquo;.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((f) => (
          <div key={f.id} className="card flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">{iconFor(f.type)}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate" title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatSize(f.size)} · {formatDate(f.createdAt)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => remove(f.id)}
                className="text-slate-500 hover:text-pink-400"
              >
                ✕
              </button>
            </div>
            {f.type.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.dataUrl}
                alt={f.name}
                className="mt-3 rounded-lg max-h-32 object-cover w-full"
              />
            )}
            <input
              className="input mt-3 !py-1.5 text-xs"
              placeholder="Add tags (comma separated)…"
              value={f.tags || ""}
              onChange={(e) => setTags(f.id, e.target.value)}
            />
            <a
              href={f.dataUrl}
              download={f.name}
              className="btn-ghost mt-2 text-sm justify-center"
            >
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function iconFor(type: string) {
  if (type.startsWith("image/")) return "🖼️";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type.includes("pdf")) return "📕";
  if (type.includes("zip") || type.includes("compressed")) return "🗜️";
  return "📄";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
