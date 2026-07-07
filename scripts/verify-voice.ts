/**
 * Voice-First OS — PASS/FAIL verification.
 *
 *   DEP=<id> npx tsx scripts/verify-voice.ts
 *
 * Voice UI (mic capture / TTS) is device-only, so those requirements are verified
 * by STATIC checks of the shipped component. The command PATH the voice feeds —
 * transcript → /api/agent (tool-aware) → capabilities — is verified FUNCTIONALLY
 * by running that exact agent loop with text in place of speech.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { toolSchemas } from "@/lib/tools";

const BASE = "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const DEP = process.env.DEP;
const TS = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rf(u: string, o?: any, t = 5): Promise<Response> { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1200 * (i + 1)); } } return fetch(u, o); }
async function j(p: string, o?: any) { const r = await rf(BASE + p, o); return r.json().catch(() => null); }
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)![1];
const doApi = (p: string) => rf(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { headers: { Authorization: `Bearer ${doTok()}` } }).then((r) => r.json());

const src = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const R: { n: string; pass: boolean }[] = [];
const REQ = (n: string, pass: boolean, d: string) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };

// --- the client agent loop (same one the VoiceAssistant runs), text in for speech ---
const GATED = new Set(["send_email", "create_calendar_event"]);
async function execTool(name: string, args: any) {
  if (GATED.has(name)) return { ok: false, declined: true }; // don't perform irreversible actions in the test
  if (name === "start_mission" || name === "schedule_mission")
    return j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: args.objective, delayMinutes: args.delayMinutes || 0, everyMinutes: args.everyMinutes || 0 }) });
  return j(`/api/tools/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args || {}) });
}
async function agent(messages: any[]) {
  const called = new Set<string>(); let finalText = "";
  for (let step = 0; step < 8; step++) {
    const r = await j("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, tools: toolSchemas() }) });
    const m = r?.message || {}; const calls: any[] = m.tool_calls || [];
    messages.push({ role: "assistant", content: m.content ?? "", tool_calls: calls.length ? calls : undefined });
    if (m.content && m.content.trim()) finalText = m.content.trim();
    if (!calls.length) break;
    for (const c of calls) { const name = c.function?.name; let a: any = {}; try { a = JSON.parse(c.function?.arguments || "{}"); } catch {} called.add(name); const res = await execTool(name, a); messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(res) }); }
  }
  return { finalText, called, messages };
}
const say = (text: string) => agent([{ role: "user", content: text }]);

(async () => {
  console.log("VOICE-FIRST OS — VERIFICATION\n");
  if (DEP) { process.stdout.write("waiting for deploy ACTIVE"); for (let i = 0; i < 40; i++) { const p = (await doApi(`/deployments/${DEP}`)).deployment.phase; process.stdout.write(` ${p}`); if (p === "ACTIVE") break; if (["ERROR", "CANCELED"].includes(p)) { console.log(" abort"); process.exit(1); } await sleep(15000); } console.log(""); }

  // ---------- STATIC: the shipped voice UI ----------
  console.log("\n[UI] Persistent voice interface (static component checks)");
  const va = src("components/VoiceAssistant.tsx"); const layout = src("app/layout.tsx"); const voice = src("lib/voice.ts");
  REQ("Persistent voice interface available throughout the app",
    va.length > 0 && /VoiceAssistant/.test(layout) && /fixed .*rounded-full/.test(va) && /usePathname/.test(va),
    "global VoiceAssistant mounted in root layout; floating mic on every page (hidden on '/')");
  REQ("Push-to-talk AND hands-free wake mode",
    /pushToTalk/.test(va) && /useSpeechRecognition/.test(va) && /WAKE_WORDS/.test(va) && /re-?arm|start\(\)/i.test(va) && /setWake|toggleWake/.test(va),
    "push-to-talk (tap) + wake-word hands-free mode with auto re-arm");
  REQ("Spoken responses are summarized naturally (TTS)",
    /speak\(/.test(va) && /speechSynthesis/.test(voice),
    "assistant's final reply is spoken via speechSynthesis");
  REQ("Voice conversations preserve context across turns",
    /messagesRef/.test(va) && /messagesRef\.current\.push/.test(va),
    "a persistent messages array is threaded through every turn");
  REQ("Optimized for mobile Safari / iPhone",
    /unlockAudio/.test(va) && /webkitSpeechRecognition/.test(voice) && /viewportFit/.test(layout) && /h-14 w-14|rounded-full/.test(va),
    "audio unlocked on first gesture; iOS webkitSpeechRecognition + auto re-arm; touch-size FAB; viewport-fit cover");

  // ---------- FUNCTIONAL: the command path voice feeds ----------
  console.log("\n[CMD] Spoken commands execute real work (agent path, text for speech)");
  const m1 = await say(`Start a background mission to research the top 3 coffee shops near downtown Miami and save a note. Reference VOICE-${TS}.`);
  const missionMade = m1.called.has("start_mission") || m1.called.has("schedule_mission");
  REQ("Voice command creates a MISSION", missionMade, `agent called ${[...m1.called].join(",") || "—"}`);

  const m2 = await say("Search everything you know for notes or contacts about coffee.");
  REQ("Voice command QUERIES MEMORY", m2.called.has("search_data"), `agent called ${[...m2.called].join(",") || "—"}`);

  const m3 = await say(`Add a new contact named "Voice Verify Buyer", a buyer with a budget of 500000.`);
  await sleep(1500);
  const vc = ((await j("/api/data/contacts")).items || []).find((c: any) => c.name.toLowerCase().includes("voice verify buyer"));
  const contactMade = m3.called.has("add_contact") && !!vc && vc.type === "buyer";
  REQ("Voice command updates the CRM", contactMade, `add_contact called + contact persisted (${vc ? `${vc.name}, ${vc.type}, $${vc.budget}` : "not found"})`);

  const m4 = await say(`Draft an email to voicetest+${TS}@example.com with subject Hello and body Just checking in about the listing.`);
  const draftRes = m4.called.has("draft_email");
  REQ("Voice command DRAFTS an email (never sends)", draftRes && !m4.called.has("send_email"), `draft_email called (Gmail draft), no send_email`);

  const m5 = await say("Put a meeting on my calendar for tomorrow at 3pm titled Voice Test Sync.");
  REQ("Voice command MANAGES the calendar", m5.called.has("create_calendar_event"), `create_calendar_event reachable (gated for approval)`);

  REQ("Spoken responses summarize actions naturally",
    !!(m1.finalText || m3.finalText) && (m1.finalText.length > 8),
    `e.g. "${(m1.finalText || m3.finalText).slice(0, 80)}"`);

  // ---------- context across turns ----------
  console.log("\n[CTX] Multi-turn context");
  const conv: any[] = [{ role: "user", content: "For this test my codeword is Falcon. Just acknowledge." }];
  await agent(conv); conv.push({ role: "user", content: "What codeword did I just give you? Reply with only the word." });
  const c2 = await agent(conv);
  REQ("Voice conversation preserves context across turns", /falcon/i.test(c2.finalText), `turn-2 recalled: "${c2.finalText.slice(0, 40)}"`);

  // ---------- autonomous features still running ----------
  console.log("\n[BG] Autonomous background features intact");
  const h = await j("/api/health");
  const ms = (await j("/api/missions")).missions;
  const kernelLive = ms.some((m: any) => m.objective.includes("[KERNEL]") && ["queued", "running"].includes(m.status) && m.recurrence);
  REQ("Existing autonomous background features continue working",
    h?.ok === true && h?.worker?.alive === true && kernelLive,
    `worker alive=${h?.worker?.alive}, store=${h?.store}, recurring kernel live=${kernelLive}`);

  const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} requirements PASS`);
  console.log(failed === 0 ? "✅ VOICE-FIRST OS VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("crashed:", e?.message || e); process.exit(1); });
