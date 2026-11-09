import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "./supabase/server";
import type { AppRole, Profile, SessionUser } from "./types";

/** Přihlášený uživatel + profil + role (ověřeno proti Supabase Auth). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", auth.user.id).single(),
    supabase.rpc("my_roles"),
  ]);
  if (!profile) return null;
  return {
    id: auth.user.id,
    email: auth.user.email ?? "",
    profile: profile as Profile,
    roles: (roles ?? []) as AppRole[],
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.profile.is_active) redirect("/login?deaktivovan=1");
  return user;
}

export async function requireRole(...roles: AppRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.some((r) => user.roles.includes(r))) redirect("/");
  return user;
}

/** Pro server actions – místo redirectu vyhodí chybu. */
export async function assertRole(...roles: AppRole[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !user.profile.is_active || !roles.some((r) => user.roles.includes(r))) {
    throw new Error("K této akci nemáte oprávnění.");
  }
  return user;
}

export const isAdmin = (u: { roles: AppRole[] }) => u.roles.includes("admin");
export const isStaff = (u: { roles: AppRole[] }) => u.roles.includes("admin") || u.roles.includes("coordinator");
