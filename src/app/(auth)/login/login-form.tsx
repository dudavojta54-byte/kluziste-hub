"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Logo } from "@/components/app-shell";
import { Field, Spinner } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";

const schema = z.object({
  email: z.email("Zadejte platný e-mail"),
  password: z.string().min(1, "Zadejte heslo"),
});

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("deaktivovan") ? "Váš účet byl deaktivován. Kontaktujte správce." : params.get("chyba"),
  );
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  // Výchozí e-mailové šablony Supabase vracejí tokeny v části URL za „#“
  // (implicit flow). Server je nevidí, proto je převezmeme zde.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    const hashError = hash.get("error_description");
    if (hashError) {
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(`/login?chyba=${encodeURIComponent("Odkaz je neplatný nebo vypršel. Požádejte o nový.")}`);
      return;
    }
    if (!access_token || !refresh_token) return;
    const type = hash.get("type");
    window.history.replaceState(null, "", window.location.pathname);
    getSupabase().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) {
        router.replace(`/login?chyba=${encodeURIComponent("Odkaz je neplatný nebo vypršel. Požádejte o nový.")}`);
        return;
      }
      router.replace(type === "invite" || type === "recovery" ? "/auth/nastavit-heslo" : "/");
      router.refresh();
    });
  }, [router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword(values);
    if (error) {
      setError(
        error.message.includes("Invalid login") ? "Nesprávný e-mail nebo heslo." :
        error.message.includes("banned") ? "Váš účet je deaktivován." : error.message,
      );
      return;
    }
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
        <div className="lg:hidden"><Logo /></div>
        <div>
          <h1 className="text-2xl font-bold">Přihlášení</h1>
          <p className="text-sm text-muted-foreground">Instructor Hub · Kluziště Praha</p>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" className="h-11" {...form.register("email")} />
        </Field>
        <Field label="Heslo" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" className="h-11" {...form.register("password")} />
        </Field>
        <Button type="submit" className="h-11 w-full text-base" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />} Přihlásit se
        </Button>
      </form>
      <div className="flex flex-col gap-1 text-center text-sm">
        <Link href="/reset-hesla" className="text-primary hover:underline">Zapomenuté heslo</Link>
        <span className="text-muted-foreground">Účty zakládá správce – registrace není veřejná.</span>
      </div>
    </div>
  );
}
