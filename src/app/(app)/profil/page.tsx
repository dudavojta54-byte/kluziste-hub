"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, KeyRound, LogOut, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, LoadingList, NativeSelect, PageHeader, SectionTitle, Spinner, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS } from "@/lib/constants";
import { useLessonTypes, useLocations } from "@/lib/queries";
import { getSupabase } from "@/lib/supabase/client";
import type { Profile, ProfilePrivate } from "@/lib/types";
import { passwordProblem } from "@/lib/validation";

export default function ProfilePage() {
  const user = useUser();
  const sb = getSupabase();
  const profile = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => (await sb.from("profiles").select("*").eq("id", user.id).single()).data as Profile,
  });
  const priv = useQuery({
    queryKey: ["profile_private", user.id],
    queryFn: async () => (await sb.from("profile_private").select("*").eq("user_id", user.id).maybeSingle()).data as ProfilePrivate | null,
  });

  if (profile.isLoading || priv.isLoading || !profile.data) return <LoadingList rows={4} />;
  return <ProfileForm initial={profile.data} initialPrivate={priv.data ?? {}} />;
}

function ProfileForm({ initial, initialPrivate }: { initial: Profile; initialPrivate: Partial<ProfilePrivate> }) {
  const user = useUser();
  const router = useRouter();
  const qc = useQueryClient();
  const types = useLessonTypes();
  const locations = useLocations();
  const sb = getSupabase();
  const [p, setP] = useState<Partial<Profile>>(initial);
  const [pp, setPp] = useState<Partial<ProfilePrivate>>(initialPrivate);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");

  const saveProfile = async () => {
    setBusy(true);
    const { error } = await sb.from("profiles").update({
      first_name: p.first_name, last_name: p.last_name, title: p.title || null, team_phone: p.team_phone || null,
      team_email: p.team_email || null, specializations: p.specializations ?? [], preferred_location_id: p.preferred_location_id || null,
      bio: p.bio || null, notify_email: p.notify_email,
    }).eq("id", user.id);
    const { error: e2 } = await sb.from("profile_private").upsert({
      user_id: user.id, personal_phone: pp.personal_phone || null, address: pp.address || null,
      bank_account: pp.bank_account || null, birth_date: pp.birth_date || null, emergency_contact: pp.emergency_contact || null,
    });
    setBusy(false);
    if (error || e2) return toast.error((error ?? e2)!.message);
    toast.success("Profil uložen.");
    qc.invalidateQueries({ queryKey: ["team"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
    router.refresh();
  };

  const [uploading, setUploading] = useState(false);
  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const blob = await resizeImage(file, 512);
      // nový soubor pokaždé (bez upsert – ten by vyžadoval i oprávnění ke čtení a přepisu)
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (error) throw new Error(`Nahrání se nezdařilo: ${error.message}`);
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error: e2 } = await sb.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      if (e2) throw new Error(e2.message);
      setP((prev) => ({ ...prev, avatar_url: url }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fotografii se nepodařilo nahrát.");
      return;
    } finally {
      setUploading(false);
    }
    qc.invalidateQueries({ queryKey: ["team"] });
    toast.success("Fotografie nahrána.");
    router.refresh();
  };

  const changePassword = async () => {
    const problem = passwordProblem(pw);
    if (problem) return toast.error(problem);
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toast.error(error.message);
    setPw("");
    toast.success("Heslo změněno.");
  };

  const toggleSpec = (code: string) => {
    const cur = p.specializations ?? [];
    setP({ ...p, specializations: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] });
  };

  return (
    <>
      <PageHeader title="Můj profil" description={`${user.email} · ${user.roles.map((r) => ROLE_LABELS[r]).join(", ")}`}
        actions={<Button onClick={saveProfile} disabled={busy}>{busy ? <Spinner /> : <Save />} Uložit změny</Button>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="gap-4 p-4 sm:p-6">
            <SectionTitle>Týmový profil</SectionTitle>
            <p className="-mt-3 text-xs text-muted-foreground">Tyto údaje vidí ostatní členové týmu.</p>
            <div className="flex items-center gap-4">
              <UserAvatar profile={{ first_name: p.first_name ?? "", last_name: p.last_name ?? "", avatar_url: p.avatar_url }} className="size-16" />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                {uploading ? <Spinner /> : <Camera className="size-4" />} {uploading ? "Nahrávám…" : "Změnit fotografii"}
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadAvatar(f); }} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jméno"><Input value={p.first_name ?? ""} onChange={(e) => setP({ ...p, first_name: e.target.value })} /></Field>
              <Field label="Příjmení"><Input value={p.last_name ?? ""} onChange={(e) => setP({ ...p, last_name: e.target.value })} /></Field>
              <Field label="Pozice / titul"><Input value={p.title ?? ""} onChange={(e) => setP({ ...p, title: e.target.value })} placeholder="např. Instruktorka bruslení" /></Field>
              <Field label="Preferovaná lokalita">
                <NativeSelect value={p.preferred_location_id ?? ""} onChange={(e) => setP({ ...p, preferred_location_id: e.target.value })}>
                  <option value="">—</option>
                  {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Telefon pro tým"><Input type="tel" value={p.team_phone ?? ""} onChange={(e) => setP({ ...p, team_phone: e.target.value })} /></Field>
              <Field label="E-mail pro tým"><Input type="email" value={p.team_email ?? ""} onChange={(e) => setP({ ...p, team_email: e.target.value })} /></Field>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">Specializace</div>
              <div className="flex flex-wrap gap-2">
                {types.data?.map((t) => (
                  <label key={t.code} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                    <Checkbox checked={(p.specializations ?? []).includes(t.code)} onCheckedChange={() => toggleSpec(t.code)} />{t.name}
                  </label>
                ))}
              </div>
            </div>
            <Field label="O mně"><Textarea rows={3} value={p.bio ?? ""} onChange={(e) => setP({ ...p, bio: e.target.value })} /></Field>
          </Card>

          <Card className="gap-4 p-4 sm:p-6">
            <SectionTitle>Soukromé údaje</SectionTitle>
            <p className="-mt-3 text-xs text-muted-foreground">Vidíte je pouze vy a správce. Slouží pro vyúčtování.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Osobní telefon"><Input type="tel" value={pp.personal_phone ?? ""} onChange={(e) => setPp({ ...pp, personal_phone: e.target.value })} /></Field>
              <Field label="Datum narození"><Input type="date" value={pp.birth_date ?? ""} onChange={(e) => setPp({ ...pp, birth_date: e.target.value })} /></Field>
              <Field label="Adresa" className="sm:col-span-2"><Input value={pp.address ?? ""} onChange={(e) => setPp({ ...pp, address: e.target.value })} /></Field>
              <Field label="Číslo účtu"><Input value={pp.bank_account ?? ""} onChange={(e) => setPp({ ...pp, bank_account: e.target.value })} placeholder="123456789/0800" /></Field>
              <Field label="Kontakt pro případ nouze"><Input value={pp.emergency_contact ?? ""} onChange={(e) => setPp({ ...pp, emergency_contact: e.target.value })} /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle>Upozornění</SectionTitle>
            <label className="flex items-center justify-between gap-3 text-sm">
              E-mailová upozornění
              <Switch checked={p.notify_email ?? true} onCheckedChange={(c) => setP({ ...p, notify_email: c })} />
            </label>
            <p className="text-xs text-muted-foreground">Upozornění v aplikaci dostáváte vždy. Nezapomeňte změnu uložit.</p>
          </Card>
          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle>Zabezpečení</SectionTitle>
            <Field label="Nové heslo" hint="Alespoň 10 znaků, písmena i číslice.">
              <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={changePassword} disabled={!pw}><KeyRound /> Změnit heslo</Button>
            <Button variant="destructive" onClick={async () => {
              await sb.auth.signOut({ scope: "global" });
              router.replace("/login");
              router.refresh();
            }}><LogOut /> Odhlásit ze všech zařízení</Button>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Zmenší fotku na čtverec max. `size` px (JPEG) – i velké fotky z telefonu mají pak pár desítek kB. */
async function resizeImage(file: File, size: number): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Vyberte obrázek (JPG, PNG nebo WebP).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Tento formát obrázku prohlížeč neumí načíst. Použijte JPG nebo PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const target = Math.min(size, side);
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d")!;
  // výřez ze středu, aby fotka v kulatém avataru nebyla deformovaná
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, target, target);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Obrázek se nepodařilo zpracovat."))), "image/jpeg", 0.85),
  );
}
