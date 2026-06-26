/**
 * Shared frame for the secondary "module" pages (CRM, Pipeline, Tasks, etc.).
 * The route group "(modules)" does not change any URLs — it only lets these
 * pages share padding so the root chat experience can stay full-bleed.
 */
export default function ModulesLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-5 lg:px-8">{children}</div>;
}
