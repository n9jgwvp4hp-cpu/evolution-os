#!/usr/bin/env node
/**
 * verify-phase2 — proves the Phase 2 operational systems on the multi-brand base.
 *
 * 1 form builder (new field types + conditional)   5 brand calendar identity
 * 2 editable per-brand pipelines                    6 global activity feed
 * 3 automatic mission creation on lead intake       7 approval queue + policy
 * 4 brand Gmail identity                            8 lead source + campaign
 *
 * Runs the full funnel: onboarding submit → brand-scoped lead → auto missions →
 * pipeline → activity. Cleans up everything it creates.
 *
 * Usage: BASE=https://<host> node scripts/verify-phase2.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const made = { formId: null, contactId: null, missionIds: [], approvalIds: [] };

async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
const check = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };

(async () => {
  console.log(`\nverify-phase2 against ${BASE}\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const prism = brands.find((b) => b.name === "Prism44");
  const quality = brands.find((b) => b.name === "Quality Management");
  const uw = brands.find((b) => b.name === "UW Equity");
  check("setup: portfolio present", !!prism && !!quality && !!uw);

  // ---------- 1. FORM BUILDER ----------
  const prismForms = (await rf(`/api/onboarding?brandId=${prism.id}`)).json.forms || [];
  const hasTypes = (f, t) => (f?.fields || []).some((x) => x.type === t);
  // The brand's primary intake form is the rich example (has multiselect); fall back to first.
  const pForm = prismForms.find((f) => hasTypes(f, "multiselect")) || prismForms[0];
  check("1 seeded Prism44 form uses rich field types (multiselect + file + url)", hasTypes(pForm, "multiselect") && hasTypes(pForm, "file") && hasTypes(pForm, "url"), (pForm?.fields || []).map((f) => f.type).join(","));
  // create a form with a conditional field + persist
  const cf = await rf("/api/onboarding", { method: "POST", body: JSON.stringify({ brandId: prism.id, title: "P2 Probe Form", fields: [
    { label: "Need file?", type: "select", options: ["Yes", "No"] },
    { label: "Upload", type: "file", showIf: { fieldId: "PLACEHOLDER", equals: "Yes" } },
  ] }) });
  made.formId = cf.json?.form?.id;
  const savedFields = cf.json?.form?.fields || [];
  check("1 form builder persists new field types (file) + conditional showIf", savedFields.some((f) => f.type === "file") && savedFields.some((f) => f.showIf), JSON.stringify(savedFields).slice(0, 120));

  // ---------- 2. EDITABLE PIPELINES ----------
  check("2 brand has default 6-stage pipeline", (prism.pipelineStages || []).length === 6 && prism.pipelineStages[0].label === "New Lead");
  const customStages = [{ key: "intake", label: "Intake" }, { key: "won", label: "Won" }];
  await rf(`/api/brands/${quality.id}`, { method: "PATCH", body: JSON.stringify({ pipelineStages: customStages }) });
  const q2 = (await rf(`/api/brands/${quality.id}`)).json.brand;
  check("2 pipeline stages are editable per brand", (q2.pipelineStages || []).length === 2 && q2.pipelineStages[1].label === "Won");
  await rf(`/api/brands/${quality.id}`, { method: "PATCH", body: JSON.stringify({ pipelineStages: prism.pipelineStages }) }); // restore

  // ---------- 3 + 8. AUTO MISSIONS + LEAD SOURCE/CAMPAIGN (the funnel) ----------
  const nameF = pForm.fields.find((f) => f.mapsTo === "name");
  const emailF = pForm.fields.find((f) => f.mapsTo === "email");
  const multiF = pForm.fields.find((f) => f.type === "multiselect");
  const sub = await rf(`/api/onboarding/${pForm.id}/submit`, { method: "POST", body: JSON.stringify({
    data: { [nameF.id]: "P2 Funnel Lead", [emailF.id]: "p2@probe.co", ...(multiF ? { [multiF.id]: [(multiF.options || ["X"])[0]] } : {}) },
    leadSource: "instagram", campaign: "spring-launch-2026",
  }) });
  made.contactId = sub.json?.contactId;
  made.missionIds = sub.json?.missionIds || [];
  check("3 onboarding submit auto-generates missions", sub.json?.ok && (sub.json.missionsCreated || 0) >= 1, JSON.stringify(sub.json).slice(0, 140));

  const leadRow = ((await rf(`/api/data/contacts?brandId=${prism.id}`)).json.items || []).find((c) => c.id === made.contactId);
  check("8 lead carries source + campaign attribution", leadRow?.leadSource === "instagram" && leadRow?.campaign === "spring-launch-2026", JSON.stringify({ s: leadRow?.leadSource, c: leadRow?.campaign }));
  check("3 lead placed at first pipeline stage + missions attached", leadRow?.pipelineStage === prism.pipelineStages[0].key && (leadRow?.attachedMissionIds || []).length >= 1);
  const missions = (await rf(`/api/missions`)).json.missions || [];
  const leadMissions = missions.filter((m) => m.contactId === made.contactId);
  check("3 auto missions are brand + lead scoped", leadMissions.length >= 1 && leadMissions.every((m) => m.brandId === prism.id && m.contactId === made.contactId), `count=${leadMissions.length}`);

  // ---------- 2b. MOVE LEAD BETWEEN STAGES ----------
  const targetStage = prism.pipelineStages[1];
  await rf(`/api/leads/${made.contactId}`, { method: "PATCH", body: JSON.stringify({ pipelineStage: targetStage.key, __stageLabel: targetStage.label }) });
  const movedLead = ((await rf(`/api/data/contacts?brandId=${prism.id}`)).json.items || []).find((c) => c.id === made.contactId);
  check("2 lead can be moved between pipeline stages", movedLead?.pipelineStage === targetStage.key);

  // ---------- 4. BRAND GMAIL IDENTITY ----------
  const id1 = (await rf(`/api/brands/${prism.id}/identity`)).json;
  check("4 brand email identity resolves (from-name + signature + templates)", id1.email?.fromName === "Prism44" && !!id1.email?.signature && (id1.email?.templates || []).length >= 1);
  check("4 falls back to primary until brand Gmail is connected", id1.email?.usingBrandAccount === false && id1.email?.primaryFallback === true);
  await rf(`/api/brands/${prism.id}`, { method: "PATCH", body: JSON.stringify({ email: { connectedEmail: "leads@prism44.com", signature: "— Prism44", templates: id1.email.templates } }) });
  const id2 = (await rf(`/api/brands/${prism.id}/identity`)).json;
  check("4 connecting a brand Gmail switches the send identity", id2.email?.usingBrandAccount === true && id2.email?.fromEmail === "leads@prism44.com");
  await rf(`/api/brands/${prism.id}`, { method: "PATCH", body: JSON.stringify({ email: { signature: id1.email.signature, templates: id1.email.templates } }) }); // restore (clears connectedEmail)

  // ---------- 5. BRAND CALENDAR ----------
  check("5 brand calendar identity resolves (primary default + event types)", id1.calendar?.calendarId === "primary" && (id1.calendar?.eventTypes || []).includes("Discovery call"));
  await rf(`/api/brands/${prism.id}`, { method: "PATCH", body: JSON.stringify({ calendar: { calendarId: "prism@group.calendar.google.com", eventTypes: id1.calendar.eventTypes } }) });
  const id3 = (await rf(`/api/brands/${prism.id}/identity`)).json;
  check("5 selecting a brand calendar is honored", id3.calendar?.usingBrandCalendar === true && id3.calendar?.calendarId.startsWith("prism@"));
  await rf(`/api/brands/${prism.id}`, { method: "PATCH", body: JSON.stringify({ calendar: { eventTypes: id1.calendar.eventTypes } }) }); // restore

  // ---------- 6. ACTIVITY FEED ----------
  const feed = (await rf(`/api/activity?brandId=${prism.id}`)).json.activity || [];
  check("6 activity feed logged the new lead + auto missions", feed.some((a) => a.kind === "new_lead" && a.refId === made.contactId) && feed.some((a) => a.kind === "mission_created"));

  // ---------- 7. APPROVAL QUEUE + POLICY ----------
  const autonomous = await rf("/api/approvals", { method: "POST", body: JSON.stringify({ actionType: "send_email" }) });
  check("7 routine actions run autonomously (send_email not gated)", autonomous.json?.gated === false);
  const internalMtg = await rf("/api/approvals", { method: "POST", body: JSON.stringify({ actionType: "create_calendar_event", payload: {} }) });
  check("7 internal meeting is autonomous", internalMtg.json?.gated === false);
  const gates = [
    ["spend_money", { amount: 500 }, "money"],
    ["send_contract", {}, "contract"],
    ["create_calendar_event", { attendees: ["x@y.com"] }, "external_meeting"],
    ["update_brand_settings", {}, "brand_setting"],
  ];
  let gateOk = true;
  for (const [type, payload, expect] of gates) {
    const r = await rf("/api/approvals", { method: "POST", body: JSON.stringify({ actionType: type, payload, brandId: prism.id, title: `Probe ${type}` }) });
    if (!(r.json?.gated && r.json.approval?.reason === expect)) { gateOk = false; console.log(`      gate miss: ${type} → ${JSON.stringify(r.json).slice(0, 80)}`); }
    if (r.json?.approval?.id) made.approvalIds.push(r.json.approval.id);
  }
  check("7 money / contract / external-meeting / brand-setting are gated with correct reason", gateOk);
  const queue = (await rf(`/api/approvals?brandId=${prism.id}`)).json.approvals || [];
  check("7 gated items surface in the approval queue", queue.length >= 4);
  // resolve one and confirm it leaves the queue
  await rf(`/api/approvals/${made.approvalIds[0]}`, { method: "POST", body: JSON.stringify({ approved: true, kind: "stored" }) });
  const queue2 = (await rf(`/api/approvals?brandId=${prism.id}`)).json.approvals || [];
  check("7 resolving an approval removes it from the queue", !queue2.some((a) => a.id === made.approvalIds[0]));

  // ---------- CLEANUP ----------
  for (const mid of made.missionIds) await rf(`/api/missions/${mid}/cancel`, { method: "POST" }).catch(() => {});
  for (const aid of made.approvalIds.slice(1)) await rf(`/api/approvals/${aid}`, { method: "POST", body: JSON.stringify({ approved: false, kind: "stored" }) }).catch(() => {});
  if (made.formId) await rf(`/api/onboarding/${made.formId}`, { method: "DELETE" });
  if (made.contactId) { // remove the probe lead
    const cur = (await rf(`/api/data/contacts`)).json.items || [];
    await rf(`/api/data/contacts`, { method: "PUT", body: JSON.stringify({ items: cur.filter((c) => c.id !== made.contactId) }) });
  }
  console.log("  · cleaned up probe form / lead / missions / approvals");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-phase2 crashed:", e); process.exit(1); });
