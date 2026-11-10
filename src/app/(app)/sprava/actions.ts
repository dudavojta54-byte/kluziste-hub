"use server";

import { assertRole } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { inviteSchema } from "@/lib/validation";
import { randomInt } from "node:crypto";

type Result = { ok: true; message: string } | { ok: false; error: string };

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Pozvání nového člena týmu e-mailem (Supabase Auth). Pouze admin. */
export async function inviteUser(input: unknown): Promise<Result> {
  try {
    await assertRole("admin");
    const v = inviteSchema.parse(input);
    const admin = createSupabaseAdmin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email.toLowerCase(), {
      data: { first_name: v.first_name, last_name: v.last_name },
      redirectTo: `${siteUrl()}/auth/confirm`,
    });
    if (error) {
      return { ok: false, error: error.message.includes("already") ? "Uživatel s tímto e-mailem už existuje." : rateLimitMessage(error.message) };
    }
    // Trigger v DB založil profil s rolí instruktor; vyšší roli přidělíme zde (ověřeno, že volá admin).
    if (v.role !== "instructor" && data.user) {
      const roles = v.role === "admin" ? ["admin", "instructor"] : ["coordinator", "instructor"];
      const { error: rErr } = await admin.from("user_roles").upsert(roles.map((role) => ({ user_id: data.user!.id, role })));
      if (rErr) return { ok: false, error: rErr.message };
    }
    return { ok: true, message: `Pozvánka odeslána na ${v.email}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pozvánku se nepodařilo odeslat." };
  }
}

function rateLimitMessage(msg: string) {
  return /rate limit/i.test(msg)
    ? "Supabase dočasně omezil odesílání e-mailů. Použijte tlačítko „Vytvořit odkaz“ a pošlete odkaz sami."
    : msg;
}

type LinkResult = { ok: true; link: string; message: string } | { ok: false; error: string };

/**
 * Odkaz pozvánky BEZ odeslání e-mailu (obchází limit e-mailů Supabase).
 * Nový uživatel: založí účet (invite). Existující, kdo se ještě nepřihlásil: odkaz pro nastavení hesla.
 * Odkaz vede na /auth/confirm (token_hash), tedy nezávisí na e-mailových šablonách.
 */
export async function createInviteLink(input: unknown): Promise<LinkResult> {
  try {
    await assertRole("admin");
    const v = inviteSchema.parse(input);
    const email = v.email.toLowerCase();
    const admin = createSupabaseAdmin();

    let res = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { first_name: v.first_name, last_name: v.last_name } },
    });
    let type: "invite" | "recovery" = "invite";
    if (res.error && /already|registered|exists/i.test(res.error.message)) {
      res = await admin.auth.admin.generateLink({ type: "recovery", email });
      type = "recovery";
    }
    if (res.error || !res.data.properties) return { ok: false, error: res.error?.message ?? "Odkaz se nepodařilo vytvořit." };

    if (type === "invite" && v.role !== "instructor" && res.data.user) {
      const roles = v.role === "admin" ? ["admin", "instructor"] : ["coordinator", "instructor"];
      const { error: rErr } = await admin.from("user_roles").upsert(roles.map((role) => ({ user_id: res.data.user!.id, role })));
      if (rErr) return { ok: false, error: rErr.message };
    }
    const link = `${siteUrl()}/auth/confirm?token_hash=${encodeURIComponent(res.data.properties.hashed_token)}&type=${type}`;
    return {
      ok: true,
      link,
      message: type === "invite" ? `Účet pro ${email} je založený.` : `${email} už účet má – odkaz slouží k nastavení hesla.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Odkaz se nepodařilo vytvořit." };
  }
}

/** Znovu odeslat pozvánku / odkaz pro nastavení hesla. */
export async function resendInvite(email: string): Promise<Result> {
  try {
    await assertRole("admin");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/auth/confirm?next=/auth/nastavit-heslo`,
    });
    if (error) return { ok: false, error: rateLimitMessage(error.message) };
    return { ok: true, message: `Odkaz pro nastavení hesla odeslán na ${email}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba" };
  }
}

/**
 * Aktivace / deaktivace účtu: v DB (RLS okamžitě přestane pouštět data, uvolní budoucí lekce)
 * + zablokování v Supabase Auth (nelze se přihlásit ani obnovit token = odhlášení ze všech zařízení).
 */
export async function setUserActive(userId: string, active: boolean): Promise<Result> {
  try {
    await assertRole("admin");
    const supabase = await createSupabaseServer();
    const { data: freed, error } = await supabase.rpc("set_user_active", { p_user: userId, p_active: active });
    if (error) return { ok: false, error: error.message };
    const admin = createSupabaseAdmin();
    const { error: aErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
    if (aErr) return { ok: false, error: aErr.message };
    return {
      ok: true,
      message: active ? "Účet byl znovu aktivován." : `Účet deaktivován${freed ? `, uvolněno ${freed} budoucích lekcí` : ""}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba" };
  }
}

/** E-mail uživatele (auth.users) – pro přehled v administraci. */
export async function listUserEmails(): Promise<Record<string, { email: string; last_sign_in_at: string | null; invited: boolean }>> {
  await assertRole("admin");
  const admin = createSupabaseAdmin();
  const out: Record<string, { email: string; last_sign_in_at: string | null; invited: boolean }> = {};
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      out[u.id] = { email: u.email ?? "", last_sign_in_at: u.last_sign_in_at ?? null, invited: !u.last_sign_in_at };
    }
    if (data.users.length < 200) break;
  }
  return out;
}

const WORDS = ["Led", "Brusle", "Puk", "Zima", "Mraz", "Vlocka", "Hokej", "Piruet", "Kluz", "Sanky", "Snih", "Rampa"];

/** Čitelné dočasné heslo, např. „Brusle-4821-Puk“ (min. 10 znaků, písmena i číslice). */
async function generateTempPassword(): Promise<string> {
  const w = () => WORDS[randomInt(WORDS.length)];
  return `${w()}-${String(randomInt(1000, 10000))}-${w()}`;
}

type PasswordResult = { ok: true; email: string; password: string; message: string } | { ok: false; error: string };

/**
 * Dočasné heslo pro existující účet – nevyprší jako jednorázové odkazy.
 * Účet se zároveň potvrdí; po přihlášení aplikace vynutí nastavení vlastního hesla.
 */
export async function setTemporaryPassword(userId: string): Promise<PasswordResult> {
  try {
    const me = await assertRole("admin");
    if (userId === me.id) return { ok: false, error: "Vlastní heslo si změňte v Mém profilu." };
    const admin = createSupabaseAdmin();
    const password = await generateTempPassword();
    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (error || !data.user) return { ok: false, error: error?.message ?? "Uživatel nenalezen." };
    return { ok: true, email: data.user.email ?? "", password, message: "Dočasné heslo je nastavené." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Heslo se nepodařilo nastavit." };
  }
}

/** Založení nového člena rovnou s dočasným heslem (bez e-mailu a bez odkazu). */
export async function createUserWithTempPassword(input: unknown): Promise<PasswordResult> {
  try {
    await assertRole("admin");
    const v = inviteSchema.parse(input);
    const email = v.email.toLowerCase();
    const admin = createSupabaseAdmin();
    const password = await generateTempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: v.first_name, last_name: v.last_name, must_change_password: true },
    });
    if (error || !data.user) {
      return {
        ok: false,
        error: error && /already|registered|exists/i.test(error.message)
          ? "Účet s tímto e-mailem už existuje – v tabulce u něj použijte „Dočasné heslo“."
          : error?.message ?? "Účet se nepodařilo založit.",
      };
    }
    if (v.role !== "instructor") {
      const roles = v.role === "admin" ? ["admin", "instructor"] : ["coordinator", "instructor"];
      const { error: rErr } = await admin.from("user_roles").upsert(roles.map((role) => ({ user_id: data.user!.id, role })));
      if (rErr) return { ok: false, error: rErr.message };
    }
    return { ok: true, email, password, message: `Účet pro ${email} je založený.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Účet se nepodařilo založit." };
  }
}
