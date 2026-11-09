/**
 * Integrační testy hlavních procesů nad skutečným PostgreSQL (PGlite)
 * se všemi migracemi, RLS politikami a RPC funkcemi.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { asUser, createDb, createUser, rpc, type Db } from "./harness";

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

let db: Db;
let admin: string, coord: string, anna: string, petr: string, eva: string;
let locId: string;
const types: Record<string, string> = {};

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400_000);
  return d.toISOString().slice(0, 10);
};

async function createLesson(
  by: string,
  o: { title?: string; type?: string; dates: string[]; start?: string; end?: string; required?: number; multiplier?: number },
) {
  const lessonId = await rpc<string>(db, by, "create_lesson", [
    JSON.stringify({
      title: o.title ?? "Školička – začátečníci",
      lesson_type_id: types[o.type ?? "skolicka"],
      location_id: locId,
      required_instructors: o.required ?? 1,
      start_time: o.start ?? "16:00",
      end_time: o.end ?? "17:30",
      dates: o.dates,
      credit_multiplier: o.multiplier ?? null,
      registration_deadline_hours: 2,
    }),
  ]);
  const occ = await db.query<{ id: string }>(
    "select id from public.lesson_occurrences where lesson_id = $1 order by starts_at",
    [lessonId],
  );
  return { lessonId, occurrences: occ.rows.map((r) => r.id) };
}

/** Posune termín do minulosti (simulace proběhlé lekce) – jako superuser. */
async function moveToPast(occId: string, hoursAgo: number, hours = 2) {
  await db.query(
    `update public.lesson_occurrences
       set starts_at = date_trunc('minute', now()) - make_interval(hours => $2::int),
           ends_at = date_trunc('minute', now()) - make_interval(hours => $2::int) + make_interval(mins => ($3::numeric * 60)::int)
     where id = $1`,
    [occId, hoursAgo, hours],
  );
}

async function assignmentOf(occId: string, userId: string) {
  return (await one<{ id: string }>(
    "select id from public.instructor_assignments where occurrence_id = $1 and user_id = $2 and status = 'active'",
    [occId, userId],
  ))!.id;
}

beforeAll(async () => {
  db = await createDb();
  admin = await createUser(db, { email: "admin@kluziste.test", first: "Jana", last: "Správcová", roles: ["admin"] });
  coord = await createUser(db, { email: "koord@kluziste.test", first: "Tomáš", last: "Koordinátor", roles: ["coordinator"] });
  anna = await createUser(db, { email: "anna@kluziste.test", first: "Anna", last: "Nováková" });
  petr = await createUser(db, { email: "petr@kluziste.test", first: "Petr", last: "Svoboda" });
  eva = await createUser(db, { email: "eva@kluziste.test", first: "Eva", last: "Dvořáková" });
  locId = (await one<{ id: string }>(
    "insert into public.locations (name) values ('Kluziště Letná') returning id",
  ))!.id;
  const t = await db.query<{ code: string; id: string }>("select code, id from public.lesson_types");
  for (const r of t.rows) types[r.code] = r.id;
});

// ---------------------------------------------------------------------
describe("1. Pozvání a přihlášení instruktora", () => {
  test("nový uživatel z Auth dostane profil, soukromý profil a roli instruktor", async () => {
    const id = await createUser(db, { email: "novy@kluziste.test", first: "Karel", last: "Nový" });
    const p = await one<{ first_name: string; team_email: string }>(
      "select first_name, team_email from public.profiles where id = $1", [id]);
    expect(p).toMatchObject({ first_name: "Karel", team_email: "novy@kluziste.test" });
    const roles = await rpc<string>(db, id, "my_roles");
    expect(roles).toContain("instructor");
    expect(await one("select 1 from public.profile_private where user_id = $1", [id])).toBeTruthy();
  });

  test("metadata pozvánky nemohou uživateli přidělit vyšší roli", async () => {
    const res = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ('hacker@x.test', '{"role":"admin"}') returning id`);
    const roles = await db.query("select role from public.user_roles where user_id = $1", [res.rows[0].id]);
    expect(roles.rows).toEqual([{ role: "instructor" }]);
  });

  test("deaktivovaný účet nevidí žádná data a nemůže se přihlašovat na lekce", async () => {
    const id = await createUser(db, { email: "odchazi@kluziste.test" });
    await rpc(db, admin, "set_user_active", [id, false]);
    const rows = await asUser(db, id, "select * from public.lesson_occurrences");
    expect(rows).toHaveLength(0);
    const { occurrences } = await createLesson(admin, { dates: [day(40)] });
    await expect(rpc(db, id, "apply_to_occurrence", [occurrences[0], null])).rejects.toThrow(/deaktivován/);
  });

  test("uživatel si upraví vlastní profil i soukromé údaje (stejné dotazy jako stránka Profil)", async () => {
    const id = await createUser(db, { email: "profil@kluziste.test", first: "", last: "" });
    await asUser(db, id, `update public.profiles set first_name = 'Vojtěch', last_name = 'Test', title = null,
      team_phone = '+420 777 000 111', team_email = 'profil@kluziste.test', specializations = '{skolicka}',
      preferred_location_id = null, bio = null, notify_email = false where id = $1`, [id]);
    await asUser(db, id, `insert into public.profile_private (user_id, bank_account) values ($1, '123/0800')
      on conflict (user_id) do update set bank_account = excluded.bank_account`, [id]);
    const p = await one<{ first_name: string; notify_email: boolean }>("select first_name, notify_email from public.profiles where id = $1", [id]);
    expect(p).toEqual({ first_name: "Vojtěch", notify_email: false });
    const pp = await one<{ bank_account: string }>("select bank_account from public.profile_private where user_id = $1", [id]);
    expect(pp!.bank_account).toBe("123/0800");
  });

  test("instruktor si nemůže sám aktivovat účet ani změnit roli", async () => {
    await expect(asUser(db, anna, "update public.profiles set is_active = false where id = $1", [anna]))
      .rejects.toThrow(/pouze správce/);
    await expect(asUser(db, anna, "insert into public.user_roles (user_id, role) values ($1, 'admin')", [anna]))
      .rejects.toThrow(/row-level security/);
  });
});

// ---------------------------------------------------------------------
describe("2. Vytvoření lekce", () => {
  test("admin vytvoří týdenní sérii se správným časem v Europe/Prague (zima i léto)", async () => {
    const { occurrences } = await createLesson(admin, {
      dates: ["2027-01-12", "2027-01-19", "2027-04-06"], start: "16:00", end: "17:30",
    });
    expect(occurrences).toHaveLength(3);
    const rows = await db.query<{ s: string; e: string }>(
      `select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') s,
              to_char(ends_at at time zone 'UTC', 'HH24:MI') e
       from public.lesson_occurrences where id = any($1) order by starts_at`, [occurrences]);
    expect(rows.rows[0]).toEqual({ s: "2027-01-12 15:00", e: "16:30" });   // SEČ = UTC+1
    expect(rows.rows[2]).toEqual({ s: "2027-04-06 14:00", e: "15:30" });   // SELČ = UTC+2
  });

  test("výchozí násobek se převezme z typu programu; speciální akce ho vyžaduje", async () => {
    const { occurrences } = await createLesson(admin, { type: "individual", dates: [day(30)] });
    const o = await one<{ m: number }>("select credit_multiplier::float8 m from public.lesson_occurrences where id = $1", [occurrences[0]]);
    expect(o!.m).toBe(2.5);
    await expect(createLesson(admin, { type: "special", dates: [day(30)] })).rejects.toThrow(/násobek/);
    const sp = await createLesson(admin, { type: "special", dates: [day(30)], multiplier: 3 });
    expect(sp.occurrences).toHaveLength(1);
  });

  test("koordinátor smí plánovat, instruktor ne", async () => {
    await expect(createLesson(coord, { dates: [day(31)] })).resolves.toBeTruthy();
    await expect(createLesson(anna, { dates: [day(31)] })).rejects.toThrow(/oprávnění/);
  });

  test("instruktoři dostanou upozornění na novou lekci", async () => {
    const before = (await one<{ n: number }>("select count(*)::int n from public.notifications where user_id = $1 and type = 'lesson_new'", [eva]))!.n;
    await createLesson(admin, { title: "Bruslení pro rodiče", dates: [day(20), day(27)] });
    const after = (await one<{ n: number }>("select count(*)::int n from public.notifications where user_id = $1 and type = 'lesson_new'", [eva]))!.n;
    expect(after).toBe(before + 1);   // jedna notifikace za celou sérii
  });

  test("úprava celé série posune čas všech budoucích termínů", async () => {
    const { occurrences } = await createLesson(admin, { dates: [day(50), day(57), day(64)] });
    const n = await rpc<number>(db, coord, "update_occurrence", [occurrences[1], JSON.stringify({ start_time: "15:00" }), "series"]);
    expect(n).toBe(2);
    const t = await db.query<{ t: string }>(
      `select to_char(starts_at at time zone 'Europe/Prague', 'HH24:MI') t from public.lesson_occurrences where id = any($1) order by starts_at`,
      [occurrences]);
    expect(t.rows.map((r) => r.t)).toEqual(["16:00", "15:00", "15:00"]);
  });
});

// ---------------------------------------------------------------------
describe("3.–4. Přihlášky, schválení, náhradníci", () => {
  test("celý proces přihlášení a schválení", async () => {
    const { occurrences: [occ] } = await createLesson(admin, { dates: [day(10)], required: 1 });

    const a = await rpc<{ id: string; status: string }>(db, anna, "apply_to_occurrence", [occ, "Ráda"]);
    expect(a.status).toBe("pending");
    // duplicitní přihláška
    await expect(rpc(db, anna, "apply_to_occurrence", [occ, null])).rejects.toThrow(/již přihlášen/);
    // přebytečná přihláška => náhradník
    const p = await rpc<{ id: string; status: string }>(db, petr, "apply_to_occurrence", [occ, null]);
    expect(p.status).toBe("waitlisted");

    // instruktor nemůže schvalovat
    await expect(rpc(db, petr, "approve_application", [a.id])).rejects.toThrow(/oprávnění/);
    await rpc(db, coord, "approve_application", [a.id]);

    const assigned = await asUser(db, anna,
      "select * from public.instructor_assignments where occurrence_id = $1 and status = 'active'", [occ]);
    expect(assigned).toHaveLength(1);
    const notif = await asUser<{ type: string }>(db, anna,
      "select type from public.notifications where type = 'application_approved'");
    expect(notif.length).toBeGreaterThan(0);

    // plná lekce – nelze schválit dalšího
    await expect(rpc(db, coord, "approve_application", [p.id])).rejects.toThrow(/plně obsazena/);

    // odhlášení > 48 h předem uvolní místo a náhradník postoupí
    const res = await rpc<string>(db, anna, "withdraw_application", [a.id]);
    expect(res).toBe("withdrawn");
    const pStatus = await one<{ status: string }>("select status from public.lesson_applications where id = $1", [p.id]);
    expect(pStatus!.status).toBe("pending");
  });

  test("odhlášení těsně před lekcí vyžaduje schválení koordinátora", async () => {
    const { occurrences: [occ] } = await createLesson(admin, { dates: [day(20)] });
    await db.query(`update public.lesson_occurrences set starts_at = now() + interval '20 hours',
      ends_at = now() + interval '22 hours', registration_deadline = null where id = $1`, [occ]);
    const a = await rpc<{ id: string }>(db, eva, "apply_to_occurrence", [occ, null]);
    await rpc(db, admin, "approve_application", [a.id]);
    expect(await rpc<string>(db, eva, "withdraw_application", [a.id])).toBe("cancel_requested");
    await rpc(db, coord, "resolve_cancel_request", [a.id, false, "Bez náhrady to nejde"]);
    const s = await one<{ status: string }>("select status from public.lesson_applications where id = $1", [a.id]);
    expect(s!.status).toBe("approved");
  });

  test("souběžné přihlášky na poslední místo – obsazeno nejvýše tolik, kolik je kapacita", async () => {
    const { occurrences: [occ] } = await createLesson(admin, { dates: [day(15)], required: 2 });
    const ids: string[] = [];
    for (const u of [anna, petr, eva]) {
      ids.push((await rpc<{ id: string }>(db, u, "apply_to_occurrence", [occ, null])).id);
    }
    const results = await Promise.allSettled(ids.map((id) => rpc(db, admin, "approve_application", [id])));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const n = await one<{ n: number }>(
      "select count(*)::int n from public.instructor_assignments where occurrence_id = $1 and status = 'active'", [occ]);
    expect(n!.n).toBe(2);
  });

  test("uzávěrka přihlášek se dodržuje", async () => {
    const { occurrences: [occ] } = await createLesson(admin, { dates: [day(5)] });
    await db.query("update public.lesson_occurrences set registration_deadline = now() - interval '1 minute' where id = $1", [occ]);
    await expect(rpc(db, anna, "apply_to_occurrence", [occ, null])).rejects.toThrow(/Uzávěrka/);
  });
});

// ---------------------------------------------------------------------
describe("5. Zabránění časovému konfliktu", () => {
  test("instruktor nemůže být ve stejný čas na dvou lekcích", async () => {
    const d = day(25);
    const { occurrences: [o1] } = await createLesson(admin, { dates: [d], start: "10:00", end: "12:00" });
    const { occurrences: [o2] } = await createLesson(admin, { dates: [d], start: "11:00", end: "13:00" });
    const { occurrences: [o3] } = await createLesson(admin, { dates: [d], start: "12:00", end: "13:00" });

    await rpc(db, admin, "assign_instructor", [o1, petr]);
    await expect(rpc(db, petr, "apply_to_occurrence", [o2, null])).rejects.toThrow(/jinou lekci/);
    await expect(rpc(db, admin, "assign_instructor", [o2, petr])).rejects.toThrow(/jinou potvrzenou lekci/);
    // navazující lekce (12:00) konflikt není
    await expect(rpc(db, admin, "assign_instructor", [o3, petr])).resolves.toBeTruthy();
  });

  test("ani přímý zápis do DB neobejde EXCLUDE constraint", async () => {
    const d = day(26);
    const { occurrences: [o1] } = await createLesson(admin, { dates: [d], start: "09:00", end: "10:00" });
    const { occurrences: [o2] } = await createLesson(admin, { dates: [d], start: "09:30", end: "10:30" });
    await rpc(db, admin, "assign_instructor", [o1, eva]);
    await expect(db.query(
      `insert into public.instructor_assignments (occurrence_id, user_id, during)
       select id, $2, tstzrange(starts_at, ends_at) from public.lesson_occurrences where id = $1`, [o2, eva]))
      .rejects.toThrow(/instructor_assignments_no_overlap/);
  });

  test("posun lekce do kolize s jiným obsazením je odmítnut", async () => {
    const d = day(27);
    const { occurrences: [o1] } = await createLesson(admin, { dates: [d], start: "09:00", end: "10:00" });
    const { occurrences: [o2] } = await createLesson(admin, { dates: [d], start: "14:00", end: "15:00" });
    await rpc(db, admin, "assign_instructor", [o1, anna]);
    await rpc(db, admin, "assign_instructor", [o2, anna]);
    await expect(rpc(db, admin, "update_occurrence", [o2, JSON.stringify({ start_time: "09:30", end_time: "10:30" }), "single"]))
      .rejects.toThrow(/konflikt/);
  });
});

// ---------------------------------------------------------------------
describe("6.–9. Kredity, bonusy, odměny a měsíční výkaz", () => {
  let occIndividual: string, occSchool: string;
  let currentPeriod = "";
  const period = () => currentPeriod;

  test("6. kredity = skutečné hodiny × násobek, zvlášť pro každého instruktora", async () => {
    // individuální lekce 2 h, dva instruktoři
    ({ occurrences: [occIndividual] } = await createLesson(admin, { type: "individual", dates: [day(60)], required: 2 }));
    await rpc(db, admin, "assign_instructor", [occIndividual, anna]);
    await rpc(db, admin, "assign_instructor", [occIndividual, petr]);
    await moveToPast(occIndividual, 3, 2);
    currentPeriod = (await one<{ p: string }>(
      "select public.period_of(starts_at)::text p from public.lesson_occurrences where id = $1", [occIndividual]))!.p;
    // kredity se nepřipisují před potvrzením
    const pre = await one<{ n: number }>("select count(*)::int n from public.credit_ledger where user_id = $1", [anna]);
    expect(pre!.n).toBe(0);

    // potvrdit smí jen admin
    await expect(rpc(db, coord, "confirm_attendance", [occIndividual, "[]"])).rejects.toThrow(/správce/);

    await rpc(db, admin, "confirm_attendance", [occIndividual, JSON.stringify([
      { assignment_id: await assignmentOf(occIndividual, anna), status: "present" },          // 2 h
      { assignment_id: await assignmentOf(occIndividual, petr), status: "partial", hours: 1 }, // 1 h
    ])]);

    const rows = await db.query<{ user_id: string; hours: number; credits: number }>(
      "select user_id, hours::float8 hours, credits::float8 credits from public.attendance_records where occurrence_id = $1",
      [occIndividual]);
    const byUser = Object.fromEntries(rows.rows.map((r) => [r.user_id, r]));
    expect(byUser[anna]).toMatchObject({ hours: 2, credits: 5 });     // 2 h × 2,5
    expect(byUser[petr]).toMatchObject({ hours: 1, credits: 2.5 });   // 1 h × 2,5
    const ledger = await db.query("select * from public.credit_ledger where attendance_id is not null and user_id = $1", [anna]);
    expect(ledger.rows).toHaveLength(1);   // žádné duplicitní záznamy

    // opakované potvrzení beze změny nevytvoří nový zápis
    await rpc(db, admin, "confirm_attendance", [occIndividual, JSON.stringify([
      { assignment_id: await assignmentOf(occIndividual, anna), status: "present" }])]);
    const ledger2 = await db.query("select * from public.credit_ledger where attendance_id is not null and user_id = $1", [anna]);
    expect(ledger2.rows).toHaveLength(1);
  });

  test("6b. oprava výkazu vytvoří korekční zápis a auditní stopu", async () => {
    await rpc(db, admin, "confirm_attendance", [occIndividual, JSON.stringify([
      { assignment_id: await assignmentOf(occIndividual, anna), status: "partial", hours: 1.5 }])]);
    const l = await db.query<{ kind: string; credits: number }>(
      `select l.kind, l.credits::float8 credits from public.credit_ledger l join public.attendance_records a on a.id = l.attendance_id
       where a.occurrence_id = $1 and l.user_id = $2 order by l.created_at`, [occIndividual, anna]);
    expect(l.rows).toEqual([{ kind: "lesson", credits: 5 }, { kind: "adjustment", credits: -1.25 }]);
    const audit = await one<{ n: number }>(
      "select count(*)::int n from public.audit_logs where table_name = 'attendance_records' and action = 'UPDATE'");
    expect(audit!.n).toBeGreaterThan(0);
    await expect(db.query("update public.credit_ledger set credits = 100")).rejects.toThrow(/nelze měnit/);
  });

  test("6c. školy a školky: 1,5 h × 2,5 = 3,75 kreditu", async () => {
    ({ occurrences: [occSchool] } = await createLesson(admin, { type: "schools", dates: [day(61)], start: "09:00", end: "10:30" }));
    await rpc(db, admin, "assign_instructor", [occSchool, anna]);
    await moveToPast(occSchool, 6, 1.5);
    await rpc(db, admin, "confirm_attendance", [occSchool, JSON.stringify([
      { assignment_id: await assignmentOf(occSchool, anna) }])]);
    const r = await one<{ c: number }>("select credits::float8 c from public.attendance_records where occurrence_id = $1", [occSchool]);
    expect(r!.c).toBe(3.75);
  });

  test("7. bonusové kredity a finanční bonus s důvodem a schvalovatelem", async () => {
    await expect(rpc(db, coord, "add_bonus", [anna, "last_minute", "Záskok", day(0), 2, 0])).rejects.toThrow(/správce/);
    const id = await rpc<string>(db, admin, "add_bonus", [anna, "last_minute", "Záskok za nemocnou kolegyni", day(0), 2, 500]);
    const b = await one<{ approved_by: string; reason_text: string }>("select * from public.bonus_records where id = $1", [id]);
    expect(b).toMatchObject({ approved_by: admin, reason_text: "Záskok za nemocnou kolegyni" });
    const l = await one<{ c: number }>("select credits::float8 c from public.credit_ledger where bonus_id = $1", [id]);
    expect(l!.c).toBe(2);
  });

  test("8. výpočet odměny podle modelu A / B / C", async () => {
    // Anna: lekce 1,5 h (3,75 kr) + škola 1,5 h (3,75 kr) = 3 h, 7,5 kr; bonus 2 kr + 500 Kč
    await db.query(`insert into public.reward_settings (user_id, model, credit_rate, valid_from)
                    values ($1, 'credit', 100, '2020-01-01')`, [anna]);
    let s = await rpc<Record<string, number | string>>(db, anna, "monthly_statement", [anna, period()]);
    expect(s.hours).toBe(3);
    expect(s.lesson_credits).toBe(7.5);
    expect(s.bonus_credits).toBe(2);
    expect(s.total_credits).toBe(9.5);
    expect(s.base_amount).toBe(950);        // 9,5 kr × 100 Kč
    expect(s.total_amount).toBe(1450);      // + 500 Kč bonus

    // B – hodinová sazba (novější nastavení má přednost)
    await db.query(`insert into public.reward_settings (user_id, model, hourly_rate, valid_from)
                    values ($1, 'hourly', 250, '2021-01-01')`, [anna]);
    s = await rpc(db, anna, "monthly_statement", [anna, period()]);
    expect(s.model).toBe("hourly");
    expect(s.total_amount).toBe(3 * 250 + 500);

    // C – fixní odměna, kredity jen jako ukazatel vůči cíli
    await db.query(`insert into public.reward_settings (user_id, model, fixed_amount, monthly_credit_target, valid_from)
                    values ($1, 'fixed', 20000, 40, '2022-01-01')`, [anna]);
    s = await rpc(db, anna, "monthly_statement", [anna, period()]);
    expect(s.base_amount).toBe(20000);
    expect(s.total_amount).toBe(20500);
    expect(s.total_credits).toBe(9.5);
    expect(s.monthly_credit_target).toBe(40);
  });

  test("9. uzavření měsíce zamkne výkaz a zachová snímek", async () => {
    const prev = new Date();
    prev.setUTCDate(1);
    prev.setUTCMonth(prev.getUTCMonth() - 2);
    const prevPeriod = prev.toISOString().slice(0, 7) + "-01";
    const prevDay = prev.toISOString().slice(0, 7) + "-15";
    const { occurrences: [occ] } = await createLesson(admin, { type: "animation", dates: [prevDay], start: "10:00", end: "14:00" });
    await rpc(db, admin, "assign_instructor", [occ, eva]);
    await rpc(db, admin, "confirm_attendance", [occ, JSON.stringify([{ assignment_id: await assignmentOf(occ, eva) }])]);
    await db.query(`insert into public.reward_settings (user_id, model, hourly_rate, valid_from) values ($1, 'hourly', 200, '2020-01-01')`, [eva]);

    await expect(rpc(db, coord, "close_period", [prevPeriod])).rejects.toThrow(/správce/);
    await rpc(db, admin, "close_period", [prevPeriod]);

    const s = await rpc<Record<string, unknown>>(db, eva, "monthly_statement", [eva, prevPeriod]);
    expect(s).toMatchObject({ closed: true, hours: 4, total_credits: 5, total_amount: 800 });

    // změna sazby po uzávěrce neovlivní uzavřený výkaz
    await db.query(`update public.reward_settings set hourly_rate = 999 where user_id = $1`, [eva]);
    const s2 = await rpc<Record<string, unknown>>(db, eva, "monthly_statement", [eva, prevPeriod]);
    expect(s2.total_amount).toBe(800);

    // změny docházky i bonusů v uzavřeném měsíci jsou zakázané
    await expect(rpc(db, admin, "confirm_attendance", [occ, JSON.stringify([
      { assignment_id: await assignmentOf(occ, eva), hours: 1 }])])).rejects.toThrow(/uzavřen/);
    await expect(rpc(db, admin, "add_bonus", [eva, "quality", "Pochvala", prevDay, 1, 0])).rejects.toThrow(/uzavřen/);

    // znovuotevření je možné jen s důvodem a je auditováno
    await expect(rpc(db, admin, "reopen_period", [prevPeriod, ""])).rejects.toThrow(/důvod/);
    await rpc(db, admin, "reopen_period", [prevPeriod, "Oprava hodin"]);
    const audit = await one<{ n: number }>("select count(*)::int n from public.audit_logs where table_name = 'report_periods'");
    expect(audit!.n).toBeGreaterThanOrEqual(2);
  });

  test("přehled týmu: koordinátor vidí hodiny a kredity, ne peníze", async () => {
    const asAdmin = await rpc<Array<Record<string, unknown>>>(db, admin, "team_overview", [period(), null, null]);
    const asCoord = await rpc<Array<Record<string, unknown>>>(db, coord, "team_overview", [period(), null, null]);
    const a1 = asAdmin.find((r) => r.user_id === anna)!;
    const a2 = asCoord.find((r) => r.user_id === anna)!;
    expect(a1.reward).toBe(20500);
    expect(a2.reward).toBeNull();
    expect(a2.hours).toBe(3);
    await expect(rpc(db, anna, "team_overview", [period(), null, null])).rejects.toThrow(/oprávnění/);
  });
});

// ---------------------------------------------------------------------
describe("10. Ochrana údajů (RLS)", () => {
  test("instruktor nevidí výkony, bonusy, sazby ani soukromé údaje jiných", async () => {
    await db.query("update public.profile_private set bank_account = '123456789/0800' where user_id = $1", [anna]);
    for (const table of ["attendance_records", "credit_ledger", "bonus_records", "reward_settings", "profile_private", "lesson_applications"]) {
      const rows = await asUser<{ user_id: string }>(db, petr, `select user_id from public.${table}`);
      expect(rows.every((r) => r.user_id === petr), table).toBe(true);
    }
    await expect(rpc(db, petr, "monthly_statement", [anna, day(0).slice(0, 7) + "-01"])).rejects.toThrow(/nemáte přístup/);
  });

  test("koordinátor nevidí finanční údaje ostatních", async () => {
    expect(await asUser(db, coord, "select * from public.reward_settings")).toHaveLength(0);
    expect(await asUser(db, coord, "select * from public.bonus_records")).toHaveLength(0);
    expect(await asUser(db, coord, "select * from public.profile_private where user_id <> $1", [coord])).toHaveLength(0);
    await expect(rpc(db, coord, "monthly_statement", [anna, day(0).slice(0, 7) + "-01"])).rejects.toThrow(/nemáte přístup/);
  });

  test("instruktor nemůže přímo zapisovat do lekcí, docházky ani kreditů", async () => {
    await expect(asUser(db, anna, `insert into public.credit_ledger (user_id, period, kind, credits)
      values ($1, '2026-01-01', 'adjustment', 1000)`, [anna])).rejects.toThrow(/row-level security/);
    const upd = await asUser(db, anna, "update public.lesson_occurrences set required_instructors = 50 returning id");
    expect(upd).toHaveLength(0);
    await expect(asUser(db, anna, "select public._compute_statement($1, '2026-01-01')", [anna])).rejects.toThrow(/permission denied/);
  });

  test("nepřihlášený uživatel nevidí nic", async () => {
    await expect(asUser(db, null, "select * from public.profiles")).rejects.toThrow(/permission denied/);
    await expect(asUser(db, null, "select public.apply_to_occurrence(gen_random_uuid(), null)")).rejects.toThrow(/permission denied/);
  });

  test("notifikace vidí jen jejich adresát; e-mailová fronta není klientům přístupná", async () => {
    const rows = await asUser<{ user_id: string }>(db, anna, "select user_id from public.notifications");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === anna)).toBe(true);
    expect(await asUser(db, anna, "select * from public.email_outbox")).toHaveLength(0);
    const queued = await one<{ n: number }>("select count(*)::int n from public.email_outbox where to_email = 'anna@kluziste.test'");
    expect(queued!.n).toBeGreaterThan(0);
  });

  test("audit log vidí pouze admin", async () => {
    expect(await asUser(db, coord, "select * from public.audit_logs")).toHaveLength(0);
    expect((await asUser(db, admin, "select * from public.audit_logs limit 1")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------
describe("Dostupnost, návrhy instruktorů, oznámení", () => {
  test("návrh instruktorů zohlední dostupnost, specializaci a konflikty", async () => {
    const d = day(35);
    const { occurrences: [occ] } = await createLesson(admin, { type: "individual", dates: [d], start: "17:00", end: "18:00" });
    await db.query("update public.profiles set specializations = '{individual}' where id = $1", [eva]);
    await asUser(db, eva, "insert into public.availability (user_id, date, kind) values ($1, $2, 'preferred')", [eva, d]);
    await asUser(db, petr, "insert into public.availability (user_id, date, kind) values ($1, $2, 'unavailable')", [petr, d]);
    const s = await rpc<Array<{ user_id: string; availability: string | null }>>(db, coord, "suggest_instructors", [occ]);
    expect(s[0].user_id).toBe(eva);
    expect(s.find((x) => x.user_id === petr)!.availability).toBe("unavailable");
    expect(s.at(-1)!.user_id === petr || s.find((x) => x.user_id === petr)).toBeTruthy();
  });

  test("instruktor nemůže zapsat dostupnost za jiného", async () => {
    await expect(asUser(db, anna, "insert into public.availability (user_id, date, kind) values ($1, current_date, 'available')", [petr]))
      .rejects.toThrow(/row-level security/);
  });

  test("důležité oznámení s potvrzením přečtení", async () => {
    const id = await rpc<string>(db, admin, "send_announcement", ["Změna otevírací doby", "Od pondělí otevíráme v 8:00.", true, null]);
    const visible = await asUser(db, anna, "select * from public.announcements where id = $1", [id]);
    expect(visible).toHaveLength(1);
    await rpc(db, anna, "mark_announcement", [id, true]);
    const r = await asUser<{ acknowledged_at: string | null }>(db, admin,
      "select acknowledged_at from public.announcement_recipients where announcement_id = $1 and user_id = $2", [id, anna]);
    expect(r[0].acknowledged_at).not.toBeNull();

    const sel = await rpc<string>(db, admin, "send_announcement", ["Jen pro Petra", "Text", false, `{${petr}}`]);
    expect(await asUser(db, anna, "select * from public.announcements where id = $1", [sel])).toHaveLength(0);
  });

  test("dashboard správce vrací provozní přehled", async () => {
    const d = await rpc<Record<string, unknown>>(db, admin, "admin_dashboard", [null]);
    expect(d).toHaveProperty("understaffed");
    expect(typeof d.active_instructors).toBe("number");
    expect(d.estimated_cost).not.toBeNull();
    const c = await rpc<Record<string, unknown>>(db, coord, "admin_dashboard", [null]);
    expect(c.estimated_cost).toBeNull();
  });
});
