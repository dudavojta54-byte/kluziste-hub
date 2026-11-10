"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/app-shell";
import { Spinner } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getSupabase } from "@/lib/supabase/client";

const EXPIRED = "Odkaz je neplatný, už byl použit, nebo vypršel. Požádejte správce o dočasné heslo nebo nový odkaz.";

function explain(message: string) {
  if (/expired|invalid|not found|already/i.test(message)) {
    return "Odkaz už neplatí – vypršel (platí 1 hodinu), byl už použit, nebo vám mezitím správce vytvořil novější. "
      + "Požádejte správce o dočasné heslo, to nevyprší.";
  }
  if (/rate limit|too many/i.test(message)) return "Příliš mnoho pokusů. Zkuste to za chvíli znovu.";
  if (/fetch|network/i.test(message)) return "Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.";
  return `${EXPIRED} (${message})`;
}

/**
 * Cíl odkazů z pozvánek a obnovy hesla.
 * Jednorázový token se ověří AŽ po kliknutí na tlačítko – náhledy odkazů
 * (WhatsApp, Messenger, e-mailové skenery) stránku jen načtou a token nespotřebují.
 */
export function ConfirmLink() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const nextParam = params.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(tokenHash || code ? null : EXPIRED);

  const isInvite = type === "invite";
  const isPassword = type === "invite" || type === "recovery" || next === "/auth/nastavit-heslo";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    // případná jiná přihlášená session (např. správce testuje odkaz) se nahradí
    const res = tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : { error: { message: "missing" } };
    if (res.error) {
      setBusy(false);
      setError(explain(res.error.message));
      return;
    }
    router.replace(isPassword ? "/auth/nastavit-heslo" : next);
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm gap-5 p-6">
        <div className="flex items-center gap-3">
          <Logo small />
          <div>
            <h1 className="text-xl font-bold">{isInvite ? "Vítejte v Instructor Hubu" : "Nastavení hesla"}</h1>
            <p className="text-sm text-muted-foreground">Kluziště Praha</p>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isInvite
              ? "Byli jste pozváni do týmu instruktorů. Pokračujte a nastavte si heslo."
              : "Pokračujte a nastavte si nové heslo."}
          </p>
        )}
        {!error && (
          <Button type="button" size="lg" className="h-11 w-full" disabled={busy} onClick={confirm}>
            {busy && <Spinner />} {isInvite ? "Přijmout pozvánku" : "Pokračovat"}
          </Button>
        )}
        <a href="/login" className="text-center text-sm text-primary hover:underline">Přejít na přihlášení</a>
      </Card>
    </div>
  );
}
