"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/app-shell";
import { Field, Spinner } from "@/components/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { passwordProblem } from "@/lib/validation";
import { getSupabase } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("Hesla se neshodují.");
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message.includes("session") ? "Odkaz vypršel – požádejte o nový." : error.message);
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm gap-5 p-6">
        <div className="flex items-center gap-3">
          <Logo small />
          <div>
            <h1 className="text-xl font-bold">Nastavení hesla</h1>
            <p className="text-sm text-muted-foreground">Vítejte v Instructor Hubu.</p>
          </div>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nové heslo" hint="Alespoň 10 znaků, písmena i číslice.">
            <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Heslo znovu">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />} Uložit a pokračovat</Button>
        </form>
      </Card>
    </div>
  );
}
