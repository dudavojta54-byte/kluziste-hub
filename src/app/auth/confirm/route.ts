import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Cíl odkazů z e-mailů Supabase Auth (pozvánka, obnova hesla).
 * Podporuje token_hash (doporučené šablony) i PKCE ?code=.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  const supabase = await createSupabaseServer();
  let error: string | null = null;

  if (tokenHash && type) {
    const res = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    error = res.error?.message ?? null;
  } else if (code) {
    const res = await supabase.auth.exchangeCodeForSession(code);
    error = res.error?.message ?? null;
  } else {
    error = "Neplatný odkaz.";
  }

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?chyba=${encodeURIComponent("Odkaz je neplatný nebo vypršel. Požádejte o nový.")}`, origin),
    );
  }
  // pozvánka i obnova hesla vedou na nastavení hesla
  const target = type === "invite" || type === "recovery" ? "/auth/nastavit-heslo" : next;
  return NextResponse.redirect(new URL(target, origin));
}
