"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, Spinner } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/auth/nastavit-heslo`,
    });
    if (error) {
      setError(error.message);
      setState("idle");
    } else setState("sent");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Obnovení hesla</h1>
        <p className="text-sm text-muted-foreground">Pošleme vám odkaz pro nastavení nového hesla.</p>
      </div>
      {state === "sent" ? (
        <Alert>
          <AlertDescription>
            Pokud u nás účet s e-mailem <b>{email}</b> existuje, odeslali jsme na něj odkaz. Zkontrolujte i složku spam.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field label="E-mail">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </Field>
          <Button type="submit" className="h-11 w-full" disabled={state === "sending"}>
            {state === "sending" && <Spinner />} Odeslat odkaz
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-center text-sm text-primary hover:underline">Zpět na přihlášení</Link>
    </div>
  );
}
