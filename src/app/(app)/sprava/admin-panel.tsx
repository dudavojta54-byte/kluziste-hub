"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Link2, MailPlus, Plus, RotateCcw, Save, Trash2, UserCheck, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, LoadingList, NativeSelect, PageHeader, Spinner, ToneBadge, TypeDot, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTACT_CATEGORY, ROLE_LABELS } from "@/lib/constants";
import { fmtDateTime, fullName } from "@/lib/format";
import { useContacts, useLessonTypes, useLocations, useRpc, useTableMutation, useTeam } from "@/lib/queries";
import { getSupabase } from "@/lib/supabase/client";
import type { AppRole, Contact, ContactCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createInviteLink, createUserWithTempPassword, inviteUser, listUserEmails, resendInvite, setTemporaryPassword, setUserActive,
} from "./actions";

const TABS = [
  ["users", "Uživatelé"], ["locations", "Lokality"], ["types", "Programy a kredity"],
  ["contacts", "Kontakty"], ["settings", "Nastavení"], ["audit", "Audit"],
] as const;

export function AdminPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("users");
  return (
    <>
      <PageHeader title="Správa" description="Uživatelé, číselníky, parametry kreditového systému a auditní stopa" />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-muted p-0.5">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
      {tab === "users" && <Users />}
      {tab === "locations" && <Locations />}
      {tab === "types" && <LessonTypes />}
      {tab === "contacts" && <Contacts />}
      {tab === "settings" && <Settings />}
      {tab === "audit" && <Audit />}
    </>
  );
}

// ------------------------------------------------------------------ uživatelé
function Users() {
  const me = useUser();
  const team = useTeam();
  const qc = useQueryClient();
  const emails = useQuery({ queryKey: ["admin", "emails"], queryFn: () => listUserEmails() });
  const [pending, start] = useTransition();
  const [f, setF] = useState({ email: "", first_name: "", last_name: "", role: "instructor" as AppRole });
  const setRoles = useRpc<{ p_user: string; p_roles: AppRole[] }>("set_user_roles", { invalidate: [["team"]], success: "Role upraveny." });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message); else toast.error(r.error);
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    });

  const [linkInfo, setLinkInfo] = useState<{ link: string; message: string } | null>(null);
  const makeLink = (input: { email: string; first_name: string; last_name: string; role: AppRole }, resetForm = false) =>
    start(async () => {
      const r = await createInviteLink(input);
      if (!r.ok) { toast.error(r.error); return; }
      setLinkInfo({ link: r.link, message: r.message });
      if (resetForm) setF({ email: "", first_name: "", last_name: "", role: "instructor" });
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    });

  const [pwInfo, setPwInfo] = useState<{ email: string; password: string; message: string } | null>(null);
  const showPassword = (fn: () => ReturnType<typeof setTemporaryPassword>, resetForm = false) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error); return; }
      setPwInfo({ email: r.email, password: r.password, message: r.message });
      if (resetForm) setF({ email: "", first_name: "", last_name: "", role: "instructor" });
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    });

  return (
    <div className="space-y-6">
      <InviteLinkDialog info={linkInfo} onClose={() => setLinkInfo(null)} />
      <TempPasswordDialog info={pwInfo} onClose={() => setPwInfo(null)} />
      <Card className="gap-3 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold"><MailPlus className="size-4" /> Pozvat nového člena</h2>
        <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <Field label="E-mail" className="sm:col-span-2"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Jméno"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
          <Field label="Příjmení"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
          <Field label="Role">
            <NativeSelect value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AppRole })}>
              <option value="instructor">Instruktor</option>
              <option value="coordinator">Koordinátor</option>
              <option value="admin">Správce</option>
            </NativeSelect>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button className="w-fit" disabled={pending || !f.email || !f.first_name || !f.last_name}
          onClick={() => showPassword(() => createUserWithTempPassword(f), true)}>
          {pending ? <Spinner /> : <KeyRound />} Založit s dočasným heslem
        </Button>
        <Button variant="outline" className="w-fit" disabled={pending || !f.email || !f.first_name || !f.last_name}
          onClick={() => run(async () => { const r = await inviteUser(f); if (r.ok) setF({ email: "", first_name: "", last_name: "", role: "instructor" }); return r; })}>
          <MailPlus /> Odeslat pozvánku e-mailem
        </Button>
        <Button variant="outline" className="w-fit" disabled={pending || !f.email || !f.first_name || !f.last_name}
          onClick={() => makeLink(f, true)}>
          <Link2 /> Vytvořit odkaz (bez e-mailu)
        </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <b>Doporučeno: „Založit s dočasným heslem“</b> – ukáže e-mail a heslo, které instruktorovi pošlete (WhatsApp, SMS).
          Heslo nevyprší; po prvním přihlášení si instruktor nastaví vlastní. E-mailová pozvánka a odkaz platí jen 1 hodinu
          a každý nový odkaz zneplatní předchozí. Veřejná registrace je vypnutá.
        </p>
      </Card>

      <Card className="gap-0 p-0">
        {team.isLoading ? <div className="p-4"><LoadingList /></div> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Uživatel</TableHead><TableHead>Role</TableHead><TableHead>Poslední přihlášení</TableHead><TableHead>Stav</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {(team.data ?? []).map((p) => {
                  const roles = p.roles as AppRole[];
                  const info = emails.data?.[p.id];
                  const toggle = (r: AppRole) => {
                    const next = roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
                    setRoles.mutate({ p_user: p.id, p_roles: next });
                  };
                  return (
                    <TableRow key={p.id} className={cn(!p.is_active && "opacity-60")}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar profile={p} />
                          <div><div className="font-medium">{fullName(p)}</div><div className="text-xs text-muted-foreground">{info?.email ?? "…"}</div></div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {(["admin", "coordinator", "instructor"] as AppRole[]).map((r) => (
                            <label key={r} className="flex items-center gap-1 text-xs">
                              <Checkbox checked={roles.includes(r)} disabled={setRoles.isPending || (p.id === me.id && r === "admin")} onCheckedChange={() => toggle(r)} />
                              {ROLE_LABELS[r]}
                            </label>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {info?.last_sign_in_at ? fmtDateTime(info.last_sign_in_at) : <ToneBadge tone="warning">Pozvánka nepřijata</ToneBadge>}
                      </TableCell>
                      <TableCell>{p.is_active ? <ToneBadge tone="success">Aktivní</ToneBadge> : <ToneBadge tone="muted">Deaktivován</ToneBadge>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {info && !info.last_sign_in_at && p.is_active && (
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => resendInvite(info.email))}><RotateCcw /> Znovu poslat</Button>
                          )}
                          {info && p.is_active && p.id !== me.id && (
                            <Button variant="ghost" size="sm" disabled={pending} title="Nové dočasné heslo (nevyprší)"
                              onClick={() => confirm(`Nastavit ${fullName(p)} nové dočasné heslo? Dosavadní heslo přestane platit.`) && showPassword(() => setTemporaryPassword(p.id))}>
                              <KeyRound /> Dočasné heslo
                            </Button>
                          )}
                          {info && p.is_active && p.id !== me.id && (
                            <Button variant="ghost" size="sm" disabled={pending} title="Odkaz pro nastavení hesla bez e-mailu (platí 1 hodinu)"
                              onClick={() => makeLink({ email: info.email, first_name: p.first_name || "-", last_name: p.last_name || "-", role: "instructor" })}>
                              <Link2 /> Odkaz
                            </Button>
                          )}
                          {p.id !== me.id && (p.is_active ? (
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={pending}
                              onClick={() => confirm(`Deaktivovat účet ${fullName(p)}? Uživatel bude odhlášen ze všech zařízení a uvolní se jeho budoucí lekce.`) && run(() => setUserActive(p.id, false))}>
                              <UserX /> Deaktivovat
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setUserActive(p.id, true))}><UserCheck /> Aktivovat</Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ číselníky
function Locations() {
  const locations = useLocations();
  const [f, setF] = useState({ name: "", address: "", color: "#0ea5e9" });
  const add = useTableMutation<typeof f>((sb, v) => sb.from("locations").insert(v), { invalidate: [["locations"]], success: "Lokalita přidána." });
  const toggle = useTableMutation<{ id: string; is_active: boolean }>((sb, v) => sb.from("locations").update({ is_active: v.is_active }).eq("id", v.id), { invalidate: [["locations"]] });
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <ul className="divide-y">
        {locations.data?.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2.5">
            <TypeDot color={l.color} className="size-3" />
            <div className="flex-1"><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.address}</div></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={l.is_active} onCheckedChange={(c) => toggle.mutate({ id: l.id, is_active: Boolean(c) })} /> Aktivní</label>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_80px_auto] sm:items-end">
        <Field label="Název"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Adresa"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Barva"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="p-1" /></Field>
        <Button disabled={!f.name.trim()} onClick={() => add.mutateAsync(f).then(() => setF({ name: "", address: "", color: "#0ea5e9" })).catch(() => {})}><Plus /> Přidat</Button>
      </div>
    </Card>
  );
}

function LessonTypes() {
  const types = useLessonTypes();
  const [edits, setEdits] = useState<Record<string, { mult: string; color: string; active: boolean }>>({});
  const save = useTableMutation<{ id: string; credit_multiplier: number | null; color: string; is_active: boolean }>(
    (sb, v) => sb.from("lesson_types").update({ credit_multiplier: v.credit_multiplier, color: v.color, is_active: v.is_active }).eq("id", v.id),
    { invalidate: [["lesson_types"], ["occurrences"]], success: "Uloženo." },
  );
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">
        Výchozí počet kreditů za 1 skutečnou hodinu. Změna se projeví u nově vytvořených lekcí; existující termíny si ponechávají svůj násobek.
        Prázdný násobek = nastavitelný u každé akce.
      </p>
      <ul className="divide-y">
        {types.data?.map((t) => {
          const e = edits[t.id] ?? { mult: t.credit_multiplier == null ? "" : String(t.credit_multiplier), color: t.color, active: t.is_active };
          const set = (patch: Partial<typeof e>) => setEdits({ ...edits, [t.id]: { ...e, ...patch } });
          return (
            <li key={t.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_120px_70px_100px_auto] sm:items-center">
              <span className="flex items-center gap-2 font-medium"><TypeDot color={e.color} className="size-3" />{t.name}</span>
              <Input inputMode="decimal" value={e.mult} placeholder="nastavitelné" onChange={(x) => set({ mult: x.target.value })} aria-label="Násobek" />
              <Input type="color" value={e.color} onChange={(x) => set({ color: x.target.value })} className="p-1" aria-label="Barva" />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={e.active} onCheckedChange={(c) => set({ active: Boolean(c) })} /> Aktivní</label>
              <Button size="sm" variant="outline" disabled={!edits[t.id]}
                onClick={() => save.mutate({ id: t.id, credit_multiplier: e.mult === "" ? null : Number(e.mult.replace(",", ".")), color: e.color, is_active: e.active })}>
                <Save /> Uložit
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Contacts() {
  const contacts = useContacts();
  const empty = { category: "coordinator" as ContactCategory, name: "", role_label: "", phone: "", email: "", note: "", sort_order: 10 };
  const [f, setF] = useState(empty);
  const add = useTableMutation<typeof f>((sb, v) => sb.from("contacts").insert({ ...v, role_label: v.role_label || null, phone: v.phone || null, email: v.email || null, note: v.note || null }),
    { invalidate: [["contacts"]], success: "Kontakt přidán." });
  const remove = useTableMutation<string>((sb, id) => sb.from("contacts").delete().eq("id", id), { invalidate: [["contacts"]] });
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <ul className="divide-y">
        {contacts.data?.map((c: Contact) => (
          <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
            <ToneBadge tone={c.category === "emergency" ? "destructive" : "info"}>{CONTACT_CATEGORY[c.category]}</ToneBadge>
            <div className="flex-1"><b>{c.name}</b> {c.role_label && <span className="text-muted-foreground">· {c.role_label}</span>}<div className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</div></div>
            <Button variant="ghost" size="icon-sm" aria-label="Smazat" onClick={() => confirm("Smazat kontakt?") && remove.mutate(c.id)}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 border-t pt-4 sm:grid-cols-3">
        <Field label="Kategorie">
          <NativeSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ContactCategory })}>
            {Object.entries(CONTACT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Jméno"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Funkce"><Input value={f.role_label} onChange={(e) => setF({ ...f, role_label: e.target.value })} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="E-mail"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Poznámka"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Button className="w-fit" disabled={!f.name.trim()} onClick={() => add.mutateAsync(f).then(() => setF(empty)).catch(() => {})}><Plus /> Přidat kontakt</Button>
      </div>
    </Card>
  );
}

function Settings() {
  const settings = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => (await getSupabase().from("app_settings").select("*").order("key")).data as { key: string; value: unknown; description: string | null }[],
  });
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = useTableMutation<{ key: string; value: unknown }>((sb, v) => sb.from("app_settings").update({ value: v.value, updated_at: new Date().toISOString() }).eq("key", v.key),
    { invalidate: [["app_settings"]], success: "Nastavení uloženo." });
  return (
    <Card className="gap-4 p-4 sm:p-5">
      {settings.data?.map((s) => {
        const v = vals[s.key] ?? (typeof s.value === "string" ? s.value : JSON.stringify(s.value));
        return (
          <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <div><div className="font-mono text-sm">{s.key}</div><div className="text-xs text-muted-foreground">{s.description}</div></div>
            <Input value={v} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
            <Button variant="outline" size="sm" disabled={vals[s.key] === undefined}
              onClick={() => save.mutate({ key: s.key, value: typeof s.value === "number" ? Number(v) : typeof s.value === "string" ? v : safeJson(v) })}>
              <Save /> Uložit
            </Button>
          </div>
        );
      })}
    </Card>
  );
}

const safeJson = (v: string) => { try { return JSON.parse(v); } catch { return v; } };

function Audit() {
  const [table, setTable] = useState("");
  const team = useTeam();
  const map = new Map((team.data ?? []).map((p) => [p.id, p]));
  const logs = useQuery({
    queryKey: ["audit", table],
    queryFn: async () => {
      let q = getSupabase().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(150);
      if (table) q = q.eq("table_name", table);
      return (await q).data as { id: number; table_name: string; record_id: string; action: string; actor: string | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; created_at: string }[];
    },
  });
  const diff = (o: Record<string, unknown> | null, n: Record<string, unknown> | null) => {
    if (!o || !n) return "";
    return Object.keys(n).filter((k) => k !== "updated_at" && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
      .map((k) => `${k}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`).join("; ");
  };
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <NativeSelect value={table} onChange={(e) => setTable(e.target.value)} className="sm:w-64">
        <option value="">Všechny tabulky</option>
        {["attendance_records", "credit_ledger", "bonus_records", "reward_settings", "report_periods", "lesson_occurrences", "lesson_applications", "instructor_assignments", "user_roles", "profiles"].map((t) => <option key={t} value={t}>{t}</option>)}
      </NativeSelect>
      {logs.isLoading ? <LoadingList /> : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Čas</TableHead><TableHead>Kdo</TableHead><TableHead>Akce</TableHead><TableHead>Tabulka</TableHead><TableHead>Změny</TableHead></TableRow></TableHeader>
            <TableBody>
              {logs.data?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</TableCell>
                  <TableCell className="text-xs">{l.actor ? fullName(map.get(l.actor)) : "systém"}</TableCell>
                  <TableCell><ToneBadge tone={l.action === "DELETE" ? "destructive" : l.action === "INSERT" ? "success" : "info"}>{l.action}</ToneBadge></TableCell>
                  <TableCell className="font-mono text-xs">{l.table_name}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-[11px] text-muted-foreground" title={diff(l.old_data, l.new_data)}>{diff(l.old_data, l.new_data) || l.record_id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function InviteLinkDialog({ info, onClose }: { info: { link: string; message: string } | null; onClose: () => void }) {
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.link);
      toast.success("Odkaz zkopírován.");
    } catch {
      toast.error("Kopírování se nezdařilo – označte odkaz a zkopírujte ho ručně.");
    }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Odkaz pozvánky</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{info?.message} Pošlete tento odkaz jen dané osobě – po otevření si nastaví heslo.
          Odkaz je jednorázový a platí omezenou dobu (výchozí 1 hodina). Náhled odkazu v chatu ho nespotřebuje – použije se až kliknutím na „Přijmout pozvánku“.</p>
        <Input readOnly value={info?.link ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zavřít</Button>
          <Button onClick={copy}><Copy /> Kopírovat odkaz</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TempPasswordDialog({ info, onClose }: { info: { email: string; password: string; message: string } | null; onClose: () => void }) {
  const site = typeof window !== "undefined" ? window.location.origin : "";
  const text = info
    ? `Ahoj, tady jsou tvoje přístupy do aplikace Instructor Hub (Kluziště Praha):\n${site}\nE-mail: ${info.email}\nDočasné heslo: ${info.password}\nPo přihlášení si nastavíš vlastní heslo.`
    : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Zpráva zkopírována – vložte ji instruktorovi do chatu.");
    } catch {
      toast.error("Kopírování se nezdařilo – označte text a zkopírujte ho ručně.");
    }
  };
  return (
    <Dialog open={!!info} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Přístupy pro instruktora</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {info?.message} Heslo se zobrazí jen teď – pošlete ho pouze dané osobě. Po přihlášení si ho instruktor musí změnit.
        </p>
        <div className="rounded-lg border bg-muted/40 p-3 font-mono text-sm">
          <div>E-mail: <b>{info?.email}</b></div>
          <div>Heslo: <b>{info?.password}</b></div>
        </div>
        <Textarea readOnly rows={5} value={text} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zavřít</Button>
          <Button onClick={copy}><Copy /> Kopírovat zprávu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
