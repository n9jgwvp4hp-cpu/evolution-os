#!/usr/bin/env node
/**
 * cleanup-sim — hard-removes every demonstration artifact created during the
 * simulation: the "Simulated Week Lead" contact, all missions created only for
 * the demo (its playbook, the research burst, the calendar-booking approvals),
 * and the demo research notes. Uses real deletes — nothing is left behind.
 *
 * Usage: BASE=https://<host> node scripts/cleanup-sim.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 700 * (i + 1))); }
  }
}

(async () => {
  console.log(`\ncleanup-sim against ${BASE}\n`);

  // 1. Find the Simulated Week Lead.
  const contacts = (await rf("/api/data/contacts")).json.items || [];
  const lead = contacts.find((c) => c.name === "Simulated Week Lead");
  const leadId = lead?.id || null;

  // 2. Identify demo missions.
  const missions = (await rf("/api/missions")).json.missions || [];
  const isDemo = (m) =>
    (leadId && m.contactId === leadId) ||
    /simulated week lead/i.test(m.objective) ||
    /^research task: find /i.test(m.objective) ||
    /save a note titled "research \d{10,}/i.test(m.objective) ||
    /^book a 30-minute discovery call for /i.test(m.objective);
  const demoMissions = missions.filter(isDemo);
  console.log(`Found: lead=${leadId ? "yes" : "no"}, demo missions=${demoMissions.length}`);

  // 3. Hard-delete demo missions.
  let removed = 0;
  for (const m of demoMissions) {
    const r = await rf(`/api/missions/${m.id}`, { method: "DELETE" });
    removed += r.json?.removed || 0;
  }
  console.log(`Deleted ${removed} demo missions.`);

  // 4. Remove the Simulated Week Lead from the CRM.
  if (leadId) {
    const keep = contacts.filter((c) => c.id !== leadId);
    await rf("/api/data/contacts", { method: "PUT", body: JSON.stringify({ items: keep }) });
    console.log(`Removed contact "Simulated Week Lead".`);
  }

  // 5. Remove demo research notes ("Research <timestamp>-<n>").
  const notes = (await rf("/api/data/notes")).json.items || [];
  const keptNotes = notes.filter((n) => !/^research \d{10,}-\d+$/i.test(String(n.title || "")));
  const noteDrop = notes.length - keptNotes.length;
  if (noteDrop > 0) {
    await rf("/api/data/notes", { method: "PUT", body: JSON.stringify({ items: keptNotes }) });
  }
  console.log(`Removed ${noteDrop} demo notes.`);

  // 6. Verify.
  const after = (await rf("/api/ops")).json;
  const s = after.sections || {};
  console.log(`\nAfter cleanup — sections: inProgress=${s.inProgress?.length || 0} blocked=${s.blocked?.length || 0} awaitingApproval=${s.waitingApproval?.length || 0} completedWhileAway=${s.completedWhileAway?.length || 0}`);
  const stillDemo = ((await rf("/api/missions")).json.missions || []).filter(isDemo).length;
  console.log(`Remaining demo missions: ${stillDemo}`);
  console.log(stillDemo === 0 ? "\n✅ All simulated data removed.\n" : "\n⚠️ Some demo missions remain (may have been mid-flight).\n");
})().catch((e) => { console.error("cleanup-sim crashed:", e); process.exit(1); });
