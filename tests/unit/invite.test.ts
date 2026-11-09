/**
 * 1. Pozvání instruktora – serverová akce: kontrola role, volání Supabase Auth Admin API,
 *    přidělení vyšší role pouze na serveru.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const assertRole = vi.fn();
const inviteUserByEmail = vi.fn();
const upsert = vi.fn();
const updateUserById = vi.fn();
const generateLink = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/auth", () => ({ assertRole: (...a: unknown[]) => assertRole(...a) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdmin: () => ({
    auth: { admin: { inviteUserByEmail, updateUserById, generateLink } },
    from: () => ({ upsert }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServer: async () => ({ rpc }) }));

const { inviteUser, setUserActive, createInviteLink } = await import("@/app/(app)/sprava/actions");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://hub.example.com/";
  inviteUserByEmail.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  upsert.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ error: null });
});

describe("pozvánka nového člena", () => {
  test("ne-admin nemůže zvát", async () => {
    assertRole.mockRejectedValue(new Error("K této akci nemáte oprávnění."));
    const r = await inviteUser({ email: "x@example.com", first_name: "A", last_name: "B", role: "instructor" });
    expect(r).toEqual({ ok: false, error: "K této akci nemáte oprávnění." });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  test("admin pozve instruktora – e-mail s odkazem na potvrzení, bez zvýšení role", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    const r = await inviteUser({ email: "Anna@Example.com", first_name: "Anna", last_name: "Nová", role: "instructor" });
    expect(r.ok).toBe(true);
    expect(assertRole).toHaveBeenCalledWith("admin");
    expect(inviteUserByEmail).toHaveBeenCalledWith("anna@example.com", {
      data: { first_name: "Anna", last_name: "Nová" },
      redirectTo: "https://hub.example.com/auth/confirm",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  test("pozvaný koordinátor dostane roli přidělenou serverem", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    await inviteUser({ email: "k@example.com", first_name: "K", last_name: "O", role: "coordinator" });
    expect(upsert).toHaveBeenCalledWith([
      { user_id: "new-user", role: "coordinator" },
      { user_id: "new-user", role: "instructor" },
    ]);
  });

  test("neplatný vstup se odmítne", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    const r = await inviteUser({ email: "neni-email", first_name: "", last_name: "", role: "superadmin" });
    expect(r.ok).toBe(false);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe("deaktivace účtu", () => {
  test("zablokuje přihlášení v Auth po úspěšné změně v DB", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    rpc.mockResolvedValue({ data: 2, error: null });
    const r = await setUserActive("u1", false);
    expect(rpc).toHaveBeenCalledWith("set_user_active", { p_user: "u1", p_active: false });
    expect(updateUserById).toHaveBeenCalledWith("u1", { ban_duration: "876000h" });
    expect(r).toMatchObject({ ok: true });
  });

  test("když DB odmítne (např. vlastní účet), Auth se nemění", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    rpc.mockResolvedValue({ data: null, error: { message: "Nemůžete deaktivovat vlastní účet." } });
    const r = await setUserActive("admin", false);
    expect(r).toEqual({ ok: false, error: "Nemůžete deaktivovat vlastní účet." });
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe("odkaz pozvánky bez e-mailu (obejde limit e-mailů)", () => {
  test("nový uživatel: založí účet a vrátí odkaz na /auth/confirm s token_hash", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    generateLink.mockResolvedValue({ data: { user: { id: "u9" }, properties: { hashed_token: "abc123" } }, error: null });
    const r = await createInviteLink({ email: "Ucitel@Example.com", first_name: "U", last_name: "C", role: "coordinator" });
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "ucitel@example.com", options: { data: { first_name: "U", last_name: "C" } } });
    expect(r).toMatchObject({ ok: true, link: "https://hub.example.com/auth/confirm?token_hash=abc123&type=invite" });
    expect(upsert).toHaveBeenCalled();
  });

  test("existující uživatel: odkaz pro nastavení hesla (recovery), role se nemění", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    generateLink
      .mockResolvedValueOnce({ data: { user: null, properties: null }, error: { message: "A user with this email address has already been registered" } })
      .mockResolvedValueOnce({ data: { user: { id: "u1" }, properties: { hashed_token: "zz" } }, error: null });
    const r = await createInviteLink({ email: "a@example.com", first_name: "A", last_name: "B", role: "admin" });
    expect(r).toMatchObject({ ok: true, link: "https://hub.example.com/auth/confirm?token_hash=zz&type=recovery" });
    expect(upsert).not.toHaveBeenCalled();
  });

  test("ne-admin nedostane odkaz", async () => {
    assertRole.mockRejectedValue(new Error("K této akci nemáte oprávnění."));
    const r = await createInviteLink({ email: "a@example.com", first_name: "A", last_name: "B", role: "instructor" });
    expect(r.ok).toBe(false);
    expect(generateLink).not.toHaveBeenCalled();
  });

  test("limit e-mailů u klasické pozvánky vrací srozumitelnou radu", async () => {
    assertRole.mockResolvedValue({ id: "admin" });
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: "email rate limit exceeded" } });
    const r = await inviteUser({ email: "x@example.com", first_name: "X", last_name: "Y", role: "instructor" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/Vytvořit odkaz/);
  });
});
