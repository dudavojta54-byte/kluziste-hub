#!/usr/bin/env node
/**
 * Demonstrační data pro zimní sezónu.
 *
 *   DEMO_PASSWORD='…' node --env-file=.env.local scripts/seed-demo.mjs
 *
 * Vytvoří demo účty (správce, koordinátor, 8 instruktorů), lokality, kontakty,
 * dokumenty a rozvrh lekcí od ~5 týdnů zpět do ~10 týdnů dopředu. Lekce, přihlášky,
 * schvalování, docházka a bonusy jdou přes stejné RPC funkce jako v aplikaci.
 * Nepoužívejte na produkční databázi s reálnými uživateli.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.DEMO_PASSWORD;
if (!URL || !ANON || !SERVICE) throw new Error("Chybí NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY");
if (!PASSWORD || PASSWORD.length < 10) throw new Error("Nastavte DEMO_PASSWORD (alespoň 10 znaků) – heslo pro všechny demo účty.");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

// ------------------------------------------------------------------ datumy (Praha)
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const seasonStart = addDays(today, -35);
const seasonEnd = addDays(today, 70);
const datesFor = (weekdays, every = 1) => {
  const out = [];
  for (let d = seasonStart, i = 0; d <= seasonEnd; d = addDays(d, 1), i++) {
    if (weekdays.includes(dow(d)) && Math.floor(i / 7) % every === 0) out.push(d);
  }
  return out;
};

// ------------------------------------------------------------------ lidé
const PEOPLE = [
  { key: "admin", first: "Jana", last: "Horáková", email: "jana.horakova@example.com", roles: ["admin"], title: "Manažerka programu" },
  { key: "coord", first: "Tomáš", last: "Beneš", email: "tomas.benes@example.com", roles: ["coordinator", "instructor"], title: "Koordinátor instruktorů", spec: ["skolicka", "schools"] },
  { key: "anna", first: "Anna", last: "Nováková", email: "anna.novakova@example.com", spec: ["skolicka", "individual"], model: ["credit", { credit_rate: 120, monthly_credit_target: 60 }] },
  { key: "petr", first: "Petr", last: "Svoboda", email: "petr.svoboda@example.com", spec: ["schools", "animation"], model: ["hourly", { hourly_rate: 260 }] },
  { key: "eva", first: "Eva", last: "Dvořáková", email: "eva.dvorakova@example.com", spec: ["individual", "special"], model: ["fixed", { fixed_amount: 18000, monthly_credit_target: 80 }] },
  { key: "lukas", first: "Lukáš", last: "Černý", email: "lukas.cerny@example.com", spec: ["skolicka", "animation"], model: ["credit", { credit_rate: 110 }] },
  { key: "tereza", first: "Tereza", last: "Procházková", email: "tereza.prochazkova@example.com", spec: ["schools", "skolicka"], model: ["hourly", { hourly_rate: 240 }] },
  { key: "martin", first: "Martin", last: "Kučera", email: "martin.kucera@example.com", spec: ["individual"], model: ["credit", { credit_rate: 130, monthly_credit_target: 40 }] },
  { key: "klara", first: "Klára", last: "Veselá", email: "klara.vesela@example.com", spec: ["animation", "special"], model: ["hourly", { hourly_rate: 230 }] },
  { key: "ondrej", first: "Ondřej", last: "Marek", email: "ondrej.marek@example.com", spec: ["skolicka", "schools"], model: ["credit", { credit_rate: 115 }] },
];

async function ensureUser(p) {
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = existing.data?.users.find((u) => u.email === p.email);
  if (found) return found.id;
  const r = must(await admin.auth.admin.createUser({
    email: p.email, password: PASSWORD, email_confirm: true, user_metadata: { first_name: p.first, last_name: p.last },
  }), `Uživatel ${p.email}`);
  return r.user.id;
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  must(await c.auth.signInWithPassword({ email, password: PASSWORD }), `Přihlášení ${email}`);
  return c;
}

console.log("→ Uživatelé");
const ids = {};
for (const p of PEOPLE) ids[p.key] = await ensureUser(p);

for (const p of PEOPLE) {
  const roles = p.roles ?? ["instructor"];
  must(await admin.from("user_roles").delete().eq("user_id", ids[p.key]), "role");
  must(await admin.from("user_roles").insert(roles.map((role) => ({ user_id: ids[p.key], role }))), "role");
  must(await admin.from("profiles").update({
    title: p.title ?? "Instruktor bruslení", specializations: p.spec ?? [],
    team_phone: `+420 7${String(Math.abs(hash(p.email))).padStart(8, "0").slice(0, 2)} ${String(Math.abs(hash(p.last))).padStart(6, "0").slice(0, 3)} ${String(Math.abs(hash(p.first))).padStart(6, "0").slice(0, 3)}`,
  }).eq("id", ids[p.key]), "profil");
}
function hash(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

console.log("→ Lokality, kontakty, dokumenty, nastavení");
const LOCS = [
  { name: "Kluziště Letná", address: "Letenská pláň, Praha 7", color: "#0ea5e9" },
  { name: "Kluziště Karlín", address: "Karlínské náměstí, Praha 8", color: "#8b5cf6" },
  { name: "Kluziště Smíchov", address: "Nádražní ulice, Praha 5", color: "#14b8a6" },
];
must(await admin.from("locations").upsert(LOCS, { onConflict: "name" }), "lokality");
const locs = Object.fromEntries(must(await admin.from("locations").select("id, name"), "lokality").map((l) => [l.name, l.id]));
const types = Object.fromEntries(must(await admin.from("lesson_types").select("id, code"), "typy").map((t) => [t.code, t.id]));

for (const p of PEOPLE) {
  if (!p.spec) continue;
  const loc = Object.values(locs)[Math.abs(hash(p.email)) % 3];
  await admin.from("profiles").update({ preferred_location_id: loc }).eq("id", ids[p.key]);
}

if (!must(await admin.from("contacts").select("id").limit(1), "kontakty").length) {
  must(await admin.from("contacts").insert([
    { category: "program_manager", name: "Jana Horáková", role_label: "Manažerka programu", phone: "+420 731 100 200", email: "program@example.com", sort_order: 1 },
    { category: "coordinator", name: "Tomáš Beneš", role_label: "Koordinátor směn", phone: "+420 732 300 400", email: "smeny@example.com", sort_order: 2 },
    { category: "rink_manager", name: "Ing. Pavel Král", role_label: "Vedoucí kluziště Letná", phone: "+420 733 500 600", sort_order: 3 },
    { category: "rink_manager", name: "Lenka Malá", role_label: "Vedoucí kluziště Karlín", phone: "+420 734 700 800", sort_order: 4 },
    { category: "tech_support", name: "Technická podpora aplikace", phone: "+420 735 900 100", email: "podpora@example.com", sort_order: 5 },
    { category: "emergency", name: "Mimořádné situace (24/7)", role_label: "Úraz, evakuace, porucha ledu", phone: "+420 736 112 112", note: "Při úrazu vždy nejdříve volejte 155.", sort_order: 0 },
  ]), "kontakty");
}
if (!must(await admin.from("documents").select("id").limit(1), "dokumenty").length) {
  must(await admin.from("documents").insert([
    { title: "Provozní řád kluzišť – výtah pro instruktory", category: "Provoz", pinned: true,
      body: "• Příchod 15 minut před začátkem lekce, převlek v zázemí za pokladnou.\n• Helma je povinná pro všechny děti do 12 let.\n• Výdej půjčovny bruslí do 10 minut před lekcí.\n• Úraz zapište do knihy úrazů a nahlaste vedoucímu kluziště." },
    { title: "Metodika školičky bruslení", category: "Metodika",
      body: "1. Rozcvička mimo led (5 min)\n2. Pády a vstávání\n3. Tučňákova chůze, jízda po jedné noze\n4. Brzdění pluhem\n5. Hry na závěr – „Na sochy“, „Mrazík“" },
    { title: "Postup při nepříznivém počasí", category: "Provoz",
      body: "Při teplotě nad 8 °C nebo dešti rozhoduje vedoucí kluziště do 12:00 o konání odpoledních lekcí. Zrušení lekcí uvidíte v aplikaci a dostanete e-mail." },
    { title: "Pravidla kreditů a odměn", category: "Odměny",
      body: "Kredity = skutečné hodiny × násobek programu.\nŠkolička 2 · Individuální 2,5 · Školy a školky 2,5 · Animace 1,25 · Speciální akce dle zadání.\nKredity se připisují po potvrzení účasti správcem. Odhlášení méně než 48 h před lekcí schvaluje koordinátor." },
  ]), "dokumenty");
}

for (const p of PEOPLE) {
  if (!p.model) continue;
  must(await admin.from("reward_settings").upsert({ user_id: ids[p.key], model: p.model[0], valid_from: "2026-09-01", ...p.model[1] }, { onConflict: "user_id,valid_from" }), "odměny");
}

// ------------------------------------------------------------------ lekce
console.log("→ Rozvrh sezóny");
const jana = await signIn(PEOPLE[0].email);
const tomas = await signIn(PEOPLE[1].email);

const existingLessons = must(await admin.from("lessons").select("id").limit(1), "lekce");
if (existingLessons.length) {
  console.log("  Lekce už existují – rozvrh přeskakuji (seed je idempotentní jen pro základní data).");
} else {
  const SERIES = [
    { title: "Školička bruslení – začátečníci", type: "skolicka", loc: "Kluziště Letná", wd: [1], start: "16:00", end: "17:30", req: 2,
      description: "Pro děti 4–7 let bez předchozích zkušeností. Max. 12 dětí.", instructions: "Kužely a pomůcky jsou v boxu č. 3. Sraz 15:45 u vstupu na led." },
    { title: "Školička bruslení – pokročilí", type: "skolicka", loc: "Kluziště Karlín", wd: [3], start: "16:00", end: "17:30", req: 2,
      description: "Jízda vzad, překládání, zastavení.", instructions: "Rozdělte děti do dvou skupin podle úrovně." },
    { title: "Bruslení pro ZŠ", type: "schools", loc: "Kluziště Letná", wd: [2, 4], start: "09:00", end: "10:30", req: 3,
      description: "Výuka bruslení v rámci tělesné výchovy, 1.–3. třída.", instructions: "Učitel je přítomen, docházku dětí potvrzuje škola." },
    { title: "Bruslení pro MŠ", type: "schools", loc: "Kluziště Smíchov", wd: [5], start: "10:00", end: "11:00", req: 2,
      description: "Seznámení s ledem pro předškoláky.", instructions: "Helmy z půjčovny, max. 8 dětí na instruktora." },
    { title: "Sobotní karneval na ledě", type: "animation", loc: "Kluziště Letná", wd: [6], every: 2, start: "10:00", end: "12:00", req: 2,
      description: "Hudba, soutěže a masky pro rodiny s dětmi.", instructions: "Kostýmy v šatně animátorů, playlist na tabletu u pultu." },
    { title: "Individuální lekce", type: "individual", loc: "Kluziště Karlín", wd: [6], start: "14:00", end: "15:00", req: 1,
      description: "Lekce 1:1 dle rezervace klienta.", instructions: "Jméno klienta a úroveň najdete v rezervaci u pokladny." },
    { title: "Individuální lekce – dospělí", type: "individual", loc: "Kluziště Letná", wd: [2], start: "18:00", end: "19:00", req: 1,
      description: "Večerní lekce pro dospělé začátečníky.", instructions: "" },
  ];
  for (const s of SERIES) {
    must(await jana.rpc("create_lesson", { p: {
      title: s.title, lesson_type_id: types[s.type], location_id: locs[s.loc], required_instructors: s.req,
      start_time: s.start, end_time: s.end, dates: datesFor(s.wd, s.every ?? 1), recurrence: "weekly",
      description: s.description, instructions: s.instructions || null, registration_deadline_hours: 24, notify: false,
    } }), s.title);
  }
  const SPECIAL = [
    { title: "Mikulášská show na ledě", date: "2026-12-05", start: "15:00", end: "18:00", req: 4, mult: 3, loc: "Kluziště Letná",
      description: "Vystoupení, nadílka a bruslení s Mikulášem.", instructions: "Kostýmy čerta a anděla zajištěny, generálka 14:00." },
    { title: "Silvestrovské bruslení", date: "2026-12-31", start: "14:00", end: "17:00", req: 3, mult: 3, loc: "Kluziště Karlín",
      description: "Odpolední silvestrovská párty na ledě.", instructions: "" },
    { title: "Valentýnské bruslení pro páry", date: "2027-02-14", start: "18:00", end: "20:00", req: 2, mult: 2.5, loc: "Kluziště Smíchov",
      description: "Večerní program pro páry s hudbou.", instructions: "" },
  ];
  for (const s of SPECIAL) {
    must(await jana.rpc("create_lesson", { p: {
      title: s.title, lesson_type_id: types.special, location_id: locs[s.loc], required_instructors: s.req, credit_multiplier: s.mult,
      start_time: s.start, end_time: s.end, dates: [s.date], description: s.description, instructions: s.instructions || null,
      registration_deadline_hours: 48, notify: false,
    } }), s.title);
  }

  // ---------------------------------------------------------------- minulé lekce: obsazení + docházka
  console.log("→ Proběhlé lekce a docházka");
  const instructors = PEOPLE.filter((p) => !p.roles || p.roles.includes("instructor")).map((p) => ids[p.key]);
  const nowIso = new Date().toISOString();
  const past = must(await admin.from("lesson_occurrences").select("id, starts_at, ends_at, required_instructors").lt("starts_at", nowIso).order("starts_at"), "minulé");
  let rr = 0;
  for (const o of past) {
    for (let k = 0, placed = 0; placed < o.required_instructors && k < instructors.length; k++) {
      const uid = instructors[rr++ % instructors.length];
      const r = await jana.rpc("assign_instructor", { p_occurrence: o.id, p_user: uid });
      if (!r.error) placed++;
    }
    const asg = must(await admin.from("instructor_assignments").select("id").eq("occurrence_id", o.id).eq("status", "active"), "přiřazení");
    const hours = (new Date(o.ends_at) - new Date(o.starts_at)) / 3_600_000;
    const entries = asg.map((a, i) => (i === 0 && Math.abs(hash(o.id)) % 9 === 0
      ? { assignment_id: a.id, status: "partial", hours: Math.max(hours - 0.5, 0.5), note: "Odchod dříve – domluveno" }
      : { assignment_id: a.id, status: "present" }));
    // pár lekcí z aktuálního měsíce nechá „čekat na potvrzení“
    const inCurrentMonth = fmt.format(new Date(o.starts_at)).slice(0, 7) === today.slice(0, 7);
    if (entries.length && !(inCurrentMonth && Math.abs(hash(o.id)) % 6 === 0)) {
      must(await jana.rpc("confirm_attendance", { p_occurrence: o.id, p_entries: entries }), "docházka");
    }
  }

  // ---------------------------------------------------------------- bonusy
  must(await jana.rpc("add_bonus", { p_user: ids.anna, p_reason: "last_minute", p_reason_text: "Záskok za nemocnou kolegyni na ZŠ", p_awarded_on: addDays(today, -3), p_credits: 3, p_amount: 0 }), "bonus");
  must(await jana.rpc("add_bonus", { p_user: ids.klara, p_reason: "new_program", p_reason_text: "Příprava nového karnevalového programu", p_awarded_on: addDays(today, -6), p_credits: 5, p_amount: 1000 }), "bonus");
  must(await jana.rpc("add_bonus", { p_user: ids.tereza, p_reason: "training", p_reason_text: "Zaškolení nového instruktora", p_awarded_on: addDays(today, -1), p_credits: 2, p_amount: 500 }), "bonus");

  // ---------------------------------------------------------------- budoucí: přihlášky a schválení
  console.log("→ Přihlášky na nadcházející lekce");
  const soon = must(await admin.from("lesson_occurrences").select("id, required_instructors").gt("starts_at", nowIso)
    .lt("starts_at", new Date(Date.now() + 21 * 86400_000).toISOString()).eq("status", "scheduled").order("starts_at"), "budoucí");
  const instrPeople = PEOPLE.filter((p) => p.model);
  const clients = {};
  for (const p of instrPeople) clients[p.key] = await signIn(p.email);
  let idx = 0;
  for (const o of soon) {
    const applicants = [instrPeople[idx % instrPeople.length], instrPeople[(idx + 3) % instrPeople.length], instrPeople[(idx + 5) % instrPeople.length]]
      .slice(0, o.required_instructors + (idx % 3 === 0 ? 1 : 0));
    idx++;
    for (const p of applicants) {
      const r = await clients[p.key].rpc("apply_to_occurrence", { p_occurrence: o.id, p_note: null });
      if (r.error) continue;
      if (idx % 4 !== 0) {   // část přihlášek nechá ke schválení
        await tomas.rpc("approve_application", { p_id: r.data.id });
      }
    }
  }

  // ---------------------------------------------------------------- dostupnost
  for (const p of instrPeople) {
    const c = clients[p.key];
    await c.from("availability").insert([
      { user_id: ids[p.key], weekday: 1 + (Math.abs(hash(p.email)) % 5), kind: "available" },
      { user_id: ids[p.key], date: addDays(today, 3 + (Math.abs(hash(p.last)) % 10)), kind: "unavailable", note: "Zkouška" },
      { user_id: ids[p.key], date: addDays(today, 2 + (Math.abs(hash(p.first)) % 10)), kind: "preferred" },
    ]);
  }

  // ---------------------------------------------------------------- oznámení
  must(await jana.rpc("send_announcement", {
    p_title: "Zahájení zimní sezóny", p_important: true, p_recipients: null,
    p_body: "Vítejte v nové sezóně! Prosíme o vyplnění dostupnosti na prosinec do konce týdne a potvrzení přečtení provozního řádu v sekci Provozní info.",
  }), "oznámení");
  must(await tomas.rpc("send_announcement", {
    p_title: "Mikulášská show – hledáme 4 instruktory", p_important: false, p_recipients: null,
    p_body: "Na Mikulášskou show 5. 12. platí kreditový násobek 3. Přihlaste se v sekci Lekce.",
  }), "oznámení");

  // uzavřít předchozí měsíc, pokud je kompletně vykázaný
  const prev = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevPeriod = prev.toISOString().slice(0, 10);
  const closed = await jana.rpc("close_period", { p_period: prevPeriod });
  console.log(closed.error ? `  Měsíc ${prevPeriod} ponechán otevřený: ${closed.error.message}` : `  Měsíc ${prevPeriod} uzavřen.`);
}

// demo e-maily neodesílat
await admin.from("email_outbox").update({ status: "skipped" }).eq("status", "pending");

console.log("\n✓ Hotovo. Demo účty (heslo = DEMO_PASSWORD):");
for (const p of PEOPLE) console.log(`  ${(p.roles ?? ["instructor"]).join("+").padEnd(24)} ${p.email}`);
