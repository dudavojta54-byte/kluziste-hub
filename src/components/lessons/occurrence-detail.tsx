"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, CalendarClock, Check, ClipboardCheck, Copy, Info, MapPin, Pencil, Sparkles, UserMinus, UserPlus, Users, X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { EmptyState, Field, LoadingList, NativeSelect, SectionTitle, Spinner, ToneBadge, TypeDot, UserAvatar } from "@/components/common";
import { ApplyButton, occurrenceRelation } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_STATUS, ATTENDANCE_STATUS, AVAILABILITY_KIND, OCCURRENCE_STATUS } from "@/lib/constants";
import { pragueDate, pragueTime } from "@/lib/dates";
import { durationHours, fmtDateTime, fmtDayLong, fmtHours, fmtNum, fmtTimeRange, fullName } from "@/lib/format";
import {
  useApplicationsFor, useLessonTypes, useLocations, useOccurrence, useProfilesById, useRpc, useSeriesCount, useSuggestions,
} from "@/lib/queries";
import { getSupabase } from "@/lib/supabase/client";
import type { AttendanceStatus, OccurrenceFull } from "@/lib/types";

export function OccurrenceDetail({ id }: { id: string }) {
  const user = useUser();
  const params = useSearchParams();
  const occ = useOccurrence(id);
  const apps = useApplicationsFor(id);

  if (occ.isLoading) return <LoadingList rows={4} />;
  if (!occ.data) return <EmptyState title="Lekce nebyla nalezena" />;
  const o = occ.data;
  const myApp = apps.data?.find((a) => a.user_id === user.id);
  const rel = occurrenceRelation(o, user.id, myApp);
  const started = new Date(o.starts_at) <= new Date();

  return (
    <div className="space-y-6">
      <Link href="/lekce" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Lekce
      </Link>

      {params.get("novy") && user.isStaff && (
        <Alert><Sparkles className="size-4" /><AlertDescription>Lekce byla vytvořena. Níže najdete návrh vhodných instruktorů.</AlertDescription></Alert>
      )}

      {/* Hlavička */}
      <Card className="gap-4 overflow-hidden p-0">
        <div className="h-1.5" style={{ backgroundColor: o.lesson_type.color }} />
        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone="muted"><TypeDot color={o.lesson_type.color} />{o.lesson_type.name}</ToneBadge>
              <ToneBadge tone={OCCURRENCE_STATUS[o.status].tone}>{OCCURRENCE_STATUS[o.status].label}</ToneBadge>
              {o.registration_status === "closed" && o.status === "scheduled" && <ToneBadge tone="muted">Přihlašování uzavřeno</ToneBadge>}
            </div>
            <h1 className="text-2xl font-bold sm:text-3xl">{o.title}</h1>
            <div className="grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2 sm:gap-x-8">
              <span className="flex items-center gap-2 capitalize"><CalendarClock className="size-4" />{fmtDayLong(o.starts_at)}, {fmtTimeRange(o.starts_at, o.ends_at)}</span>
              <span className="flex items-center gap-2"><MapPin className="size-4" />{o.location.name}</span>
              <span className="flex items-center gap-2"><Users className="size-4" />{rel.assigned.length} / {o.required_instructors} instruktorů</span>
              <span className="flex items-center gap-2"><Sparkles className="size-4" />{fmtNum(o.credit_multiplier)} kr / hod · {fmtNum(durationHours(o.starts_at, o.ends_at) * o.credit_multiplier)} kr za lekci</span>
            </div>
            {o.registration_deadline && o.status === "scheduled" && (
              <p className="text-xs text-muted-foreground">Uzávěrka přihlášek: {fmtDateTime(o.registration_deadline)}</p>
            )}
            {o.status === "cancelled" && o.cancel_reason && (
              <p className="text-sm text-destructive">Důvod zrušení: {o.cancel_reason}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <MyActions o={o} myApp={myApp} canApply={rel.canApply} isMine={rel.isMine} />
            {user.isStaff && o.status === "scheduled" && (
              <>
                <EditDialog o={o} />
                <CancelDialog o={o} />
              </>
            )}
            {user.isStaff && (
              <Button variant="outline" render={<Link href={`/lekce/nova?kopie=${o.id}`} />}><Copy /> Kopírovat</Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {(o.description || o.instructions) && (
            <Card className="gap-4 p-4 sm:p-6">
              {o.description && (<div><h2 className="mb-1 font-semibold">Popis programu</h2><p className="whitespace-pre-line text-sm text-muted-foreground">{o.description}</p></div>)}
              {o.instructions && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <h2 className="mb-1 flex items-center gap-2 font-semibold"><Info className="size-4 text-primary" /> Pokyny pro instruktory</h2>
                  <p className="whitespace-pre-line text-sm">{o.instructions}</p>
                </div>
              )}
            </Card>
          )}

          {user.isAdmin && started && o.status !== "cancelled" && <AttendancePanel o={o} />}
          {user.isStaff && o.status === "scheduled" && <ApplicationsPanel o={o} />}
        </div>

        <div className="space-y-6">
          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle>Obsazení</SectionTitle>
            {rel.assigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím nikdo není přiřazen.</p>
            ) : (
              <ul className="space-y-2">
                {rel.assigned.map((a) => (
                  <AssignedRow key={a.id} assignmentId={a.id} userId={a.user_id} canRemove={user.isStaff && o.status === "scheduled"} />
                ))}
              </ul>
            )}
            {rel.free > 0 && o.status === "scheduled" && (
              <p className="text-sm text-muted-foreground">Volná místa: <b className="text-foreground">{rel.free}</b></p>
            )}
          </Card>
          {user.isStaff && o.status === "scheduled" && rel.free > 0 && <SuggestionsPanel o={o} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ instruktor
function MyActions({ o, myApp, canApply, isMine }: {
  o: OccurrenceFull;
  myApp?: { id: string; status: keyof typeof APPLICATION_STATUS };
  canApply: boolean;
  isMine: boolean;
}) {
  const withdraw = useRpc<{ p_id: string }, string>("withdraw_application", {
    success: (r) => (r === "cancel_requested" ? "Lekce začíná brzy – žádost o zrušení odeslána koordinátorovi." : "Odhlášení proběhlo."),
  });
  if (o.status !== "scheduled") return null;
  if (canApply) return <ApplyButton occurrenceId={o.id} size="lg" />;
  if (!myApp) return null;
  const status = APPLICATION_STATUS[myApp.status];
  const canWithdraw = ["pending", "waitlisted", "approved"].includes(myApp.status) && new Date(o.starts_at) > new Date();
  return (
    <div className="flex items-center gap-2">
      <ToneBadge tone={isMine ? "success" : status.tone} className="py-1.5 text-sm">{isMine ? "Jste přiřazen(a)" : status.label}</ToneBadge>
      {canWithdraw && (
        <Button variant="outline" disabled={withdraw.isPending}
          onClick={() => confirm(myApp.status === "approved" ? "Opravdu se chcete z lekce odhlásit?" : "Zrušit přihlášku?") && withdraw.mutate({ p_id: myApp.id })}>
          {withdraw.isPending ? <Spinner /> : <X />} {myApp.status === "approved" ? "Odhlásit se" : "Zrušit přihlášku"}
        </Button>
      )}
    </div>
  );
}

function AssignedRow({ assignmentId, userId, canRemove }: { assignmentId: string; userId: string; canRemove: boolean }) {
  const { map } = useProfilesById();
  const p = map.get(userId);
  const remove = useRpc<{ p_assignment: string; p_reason: string | null }>("remove_assignment", { success: "Instruktor odebrán z lekce." });
  return (
    <li className="flex items-center gap-3">
      <UserAvatar profile={p} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{fullName(p)}</div>
        {p?.team_phone && <a href={`tel:${p.team_phone}`} className="text-xs text-muted-foreground hover:text-primary">{p.team_phone}</a>}
      </div>
      {canRemove && (
        <Button variant="ghost" size="icon-sm" aria-label="Odebrat z lekce" disabled={remove.isPending}
          onClick={() => {
            const reason = prompt("Důvod odebrání (uvidí ho instruktor):");
            if (reason !== null) remove.mutate({ p_assignment: assignmentId, p_reason: reason || null });
          }}>
          <UserMinus />
        </Button>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ staff
function ApplicationsPanel({ o }: { o: OccurrenceFull }) {
  const apps = useApplicationsFor(o.id);
  const { map } = useProfilesById();
  const approve = useRpc<{ p_id: string }>("approve_application", { success: "Přihláška schválena." });
  const reject = useRpc<{ p_id: string; p_note: string | null }>("reject_application", { success: "Přihláška zamítnuta." });
  const resolve = useRpc<{ p_id: string; p_approve: boolean; p_note: string | null }>("resolve_cancel_request", { success: "Žádost vyřízena." });
  const open = (apps.data ?? []).filter((a) => ["pending", "waitlisted", "cancel_requested"].includes(a.status));
  const history = (apps.data ?? []).filter((a) => !["pending", "waitlisted", "cancel_requested"].includes(a.status));

  return (
    <Card className="gap-3 p-4 sm:p-6">
      <SectionTitle>Přihlášky</SectionTitle>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">Žádné čekající přihlášky.</p>
      ) : (
        <ul className="divide-y">
          {open.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar profile={map.get(a.user_id)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{fullName(map.get(a.user_id))}</div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(a.created_at)}{a.note ? ` · „${a.note}“` : ""}</div>
                </div>
                <ToneBadge tone={APPLICATION_STATUS[a.status].tone}>{APPLICATION_STATUS[a.status].label}</ToneBadge>
              </div>
              <div className="flex gap-2">
                {a.status === "cancel_requested" ? (
                  <>
                    <Button size="sm" onClick={() => resolve.mutate({ p_id: a.id, p_approve: true, p_note: null })}><Check /> Uvolnit</Button>
                    <Button size="sm" variant="outline" onClick={() => resolve.mutate({ p_id: a.id, p_approve: false, p_note: prompt("Zpráva instruktorovi (nepovinné):") })}>Ponechat</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ p_id: a.id })}><Check /> Schválit</Button>
                    <Button size="sm" variant="outline" disabled={reject.isPending}
                      onClick={() => { const n = prompt("Důvod zamítnutí (nepovinné):"); if (n !== null) reject.mutate({ p_id: a.id, p_note: n || null }); }}>
                      <X /> Zamítnout
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Historie přihlášek ({history.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>{fullName(map.get(a.user_id))}</span>
                <ToneBadge tone={APPLICATION_STATUS[a.status].tone}>{APPLICATION_STATUS[a.status].label}</ToneBadge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function SuggestionsPanel({ o }: { o: OccurrenceFull }) {
  const s = useSuggestions(o.id, true);
  const assign = useRpc<{ p_occurrence: string; p_user: string }>("assign_instructor", { success: "Instruktor přiřazen." });
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionTitle>Doporučení instruktoři</SectionTitle>
      <p className="-mt-2 text-xs text-muted-foreground">Podle dostupnosti, specializace, lokality a vytížení v měsíci.</p>
      {s.isLoading ? <LoadingList rows={2} /> : (
        <ul className="space-y-2">
          {(s.data ?? []).slice(0, 8).map((x) => (
            <li key={x.user_id} className="flex items-center gap-2">
              <UserAvatar profile={{ first_name: x.name.split(" ")[0] ?? "", last_name: x.name.split(" ")[1] ?? "", avatar_url: x.avatar_url }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.name}</div>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {x.has_conflict && <ToneBadge tone="destructive">Kolize</ToneBadge>}
                  {x.availability && <ToneBadge tone={AVAILABILITY_KIND[x.availability].tone}>{AVAILABILITY_KIND[x.availability].label}</ToneBadge>}
                  {x.specialization_match && <ToneBadge tone="info">Specializace</ToneBadge>}
                  {x.application_status && <ToneBadge tone="warning">{APPLICATION_STATUS[x.application_status].label}</ToneBadge>}
                  <span className="text-muted-foreground">{fmtHours(x.month_hours)} / měsíc</span>
                </div>
              </div>
              <Button size="icon-sm" variant="outline" aria-label={`Přiřadit ${x.name}`} disabled={x.has_conflict || assign.isPending}
                onClick={() => assign.mutate({ p_occurrence: o.id, p_user: x.user_id })}>
                <UserPlus />
              </Button>
            </li>
          ))}
          {s.data?.length === 0 && <li className="text-sm text-muted-foreground">Žádní další dostupní instruktoři.</li>}
        </ul>
      )}
    </Card>
  );
}

function EditDialog({ o }: { o: OccurrenceFull }) {
  const [open, setOpen] = useState(false);
  const types = useLessonTypes();
  const locations = useLocations();
  const seriesCount = useSeriesCount(o.lesson_id);
  const update = useRpc<{ p_id: string; p: Record<string, unknown>; p_scope: string }, number>("update_occurrence", {
    success: (n) => (n > 1 ? `Upraveno ${n} termínů.` : "Lekce upravena."),
  });
  const [f, setF] = useState(() => initEdit(o));
  const [scope, setScope] = useState<"single" | "series">("single");
  const set = (k: keyof ReturnType<typeof initEdit>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const p: Record<string, unknown> = {
      title: f.title, lesson_type_id: f.lesson_type_id, location_id: f.location_id,
      start_time: f.start_time, end_time: f.end_time, required_instructors: Number(f.required_instructors),
      credit_multiplier: Number(f.credit_multiplier), description: f.description, instructions: f.instructions,
      registration_status: f.registration_status, registration_deadline_hours: Number(f.deadline_hours),
    };
    if (scope === "single") p.date = f.date;
    await update.mutateAsync({ p_id: o.id, p, p_scope: scope }).then(() => setOpen(false)).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setF(initEdit(o)); }}>
      <Button variant="outline" onClick={() => setOpen(true)}><Pencil /> Upravit</Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Upravit lekci</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Název" className="sm:col-span-2"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="Typ programu">
            <NativeSelect value={f.lesson_type_id} onChange={set("lesson_type_id")}>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Lokalita">
            <NativeSelect value={f.location_id} onChange={set("location_id")}>
              {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Datum" hint={scope === "series" ? "U série se datum nemění" : undefined}>
            <Input type="date" value={f.date} onChange={set("date")} disabled={scope === "series"} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Začátek"><Input type="time" value={f.start_time} onChange={set("start_time")} /></Field>
            <Field label="Konec"><Input type="time" value={f.end_time} onChange={set("end_time")} /></Field>
          </div>
          <Field label="Počet instruktorů"><Input type="number" min={1} value={f.required_instructors} onChange={set("required_instructors")} /></Field>
          <Field label="Kreditový násobek"><Input type="number" step="0.05" min={0} value={f.credit_multiplier} onChange={set("credit_multiplier")} /></Field>
          <Field label="Přihlašování">
            <NativeSelect value={f.registration_status} onChange={set("registration_status")}>
              <option value="open">Otevřené</option>
              <option value="closed">Uzavřené</option>
            </NativeSelect>
          </Field>
          <Field label="Uzávěrka (hod. předem)"><Input type="number" min={0} value={f.deadline_hours} onChange={set("deadline_hours")} /></Field>
          <Field label="Popis" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set("description")} /></Field>
          <Field label="Pokyny pro instruktory" className="sm:col-span-2"><Textarea rows={2} value={f.instructions} onChange={set("instructions")} /></Field>
        </div>
        {(seriesCount.data ?? 0) > 1 && (
          <div className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-medium">Rozsah úpravy</div>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
              <label className="flex items-center gap-2"><input type="radio" checked={scope === "single"} onChange={() => setScope("single")} /> Pouze tento termín</label>
              <label className="flex items-center gap-2"><input type="radio" checked={scope === "series"} onChange={() => setScope("series")} /> Tento a všechny další termíny série</label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button onClick={save} disabled={update.isPending}>{update.isPending && <Spinner />} Uložit změny</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initEdit(o: OccurrenceFull) {
  const deadline = o.registration_deadline
    ? Math.round((new Date(o.starts_at).getTime() - new Date(o.registration_deadline).getTime()) / 3_600_000)
    : 0;
  return {
    title: o.title, lesson_type_id: o.lesson_type_id, location_id: o.location_id,
    date: pragueDate(o.starts_at), start_time: pragueTime(o.starts_at), end_time: pragueTime(o.ends_at),
    required_instructors: String(o.required_instructors), credit_multiplier: String(o.credit_multiplier),
    description: o.description ?? "", instructions: o.instructions ?? "",
    registration_status: o.registration_status, deadline_hours: String(deadline),
  };
}

function CancelDialog({ o }: { o: OccurrenceFull }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<"single" | "series">("single");
  const seriesCount = useSeriesCount(o.lesson_id);
  const cancel = useRpc<{ p_id: string; p_reason: string; p_scope: string }, number>("cancel_occurrence", {
    success: (n) => `Zrušeno ${n} ${n === 1 ? "termín" : "termínů"}. Instruktoři byli upozorněni.`,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="destructive" onClick={() => setOpen(true)}><Ban /> Zrušit lekci</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Zrušit lekci</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Přiřazení instruktoři i čekající přihlášky dostanou upozornění.</p>
        <Field label="Důvod zrušení"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="např. Nevyhovující stav ledu" /></Field>
        {(seriesCount.data ?? 0) > 1 && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={scope === "single"} onChange={() => setScope("single")} /> Pouze tento termín</label>
            <label className="flex items-center gap-2"><input type="radio" checked={scope === "series"} onChange={() => setScope("series")} /> Tento a všechny další termíny série</label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zpět</Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending}
            onClick={() => cancel.mutateAsync({ p_id: o.id, p_reason: reason.trim(), p_scope: scope }).then(() => setOpen(false)).catch(() => {})}>
            {cancel.isPending && <Spinner />} Zrušit lekci
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ docházka (admin)
function AttendancePanel({ o }: { o: OccurrenceFull }) {
  const { map } = useProfilesById();
  const assigned = o.assignments.filter((a) => a.status === "active");
  const records = useQuery({
    queryKey: ["statement", "attendance", o.id],
    queryFn: async () => {
      const { data, error } = await getSupabase().from("attendance_records").select("*").eq("occurrence_id", o.id);
      if (error) throw new Error(error.message);
      return data as { assignment_id: string; status: AttendanceStatus; hours: number; credits: number; note: string | null; confirmed_at: string }[];
    },
  });
  const planned = durationHours(o.starts_at, o.ends_at);
  const [entries, setEntries] = useState<Record<string, { status: AttendanceStatus; hours: string; note: string }>>({});
  const confirmAtt = useRpc<{ p_occurrence: string; p_entries: unknown[] }, number>("confirm_attendance", {
    success: (n) => `Účast potvrzena (${n}). Kredity byly připsány.`,
  });

  const row = (assignmentId: string) => {
    const existing = records.data?.find((r) => r.assignment_id === assignmentId);
    return entries[assignmentId] ?? {
      status: existing?.status ?? "present",
      hours: String(existing ? existing.hours : planned),
      note: existing?.note ?? "",
    };
  };
  const update = (id: string, patch: Partial<{ status: AttendanceStatus; hours: string; note: string }>) =>
    setEntries((e) => ({ ...e, [id]: { ...row(id), ...patch } }));

  const submit = () => {
    const payload = assigned.map((a) => {
      const r = row(a.id);
      return { assignment_id: a.id, status: r.status, hours: r.status === "absent" ? 0 : Number(r.hours.replace(",", ".")), note: r.note || null };
    });
    confirmAtt.mutate({ p_occurrence: o.id, p_entries: payload }, { onSuccess: () => setEntries({}) });
  };

  return (
    <Card id="dochazka" className="scroll-mt-20 gap-3 p-4 sm:p-6">
      <SectionTitle>
        <span className="flex items-center gap-2"><ClipboardCheck className="size-5 text-primary" /> Potvrzení účasti</span>
      </SectionTitle>
      <p className="-mt-2 text-sm text-muted-foreground">
        Zadejte skutečně odpracované hodiny. Kredity = hodiny × {fmtNum(o.credit_multiplier)}. Opravy se ukládají jako korekční záznamy s auditní stopou.
      </p>
      {assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">Na lekci není nikdo přiřazen. Záskok přidáte přes doporučené instruktory nebo úpravu kapacity.</p>
      ) : (
        <div className="space-y-3">
          {assigned.map((a) => {
            const r = row(a.id);
            const existing = records.data?.find((x) => x.assignment_id === a.id);
            const hours = r.status === "absent" ? 0 : Number(r.hours.replace(",", ".")) || 0;
            return (
              <div key={a.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_150px_100px_auto] sm:items-center">
                <div className="flex items-center gap-2">
                  <UserAvatar profile={map.get(a.user_id)} />
                  <div>
                    <div className="text-sm font-medium">{fullName(map.get(a.user_id))}</div>
                    {existing && <div className="text-[11px] text-success">Potvrzeno {fmtDateTime(existing.confirmed_at)}</div>}
                  </div>
                </div>
                <NativeSelect value={r.status} onChange={(e) => update(a.id, { status: e.target.value as AttendanceStatus })}>
                  {Object.entries(ATTENDANCE_STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </NativeSelect>
                <Input inputMode="decimal" value={r.status === "absent" ? "0" : r.hours} disabled={r.status === "absent"}
                  onChange={(e) => update(a.id, { hours: e.target.value, status: r.status === "present" && Number(e.target.value) < planned ? "partial" : r.status })}
                  aria-label="Hodiny" />
                <div className="text-right text-sm tabular-nums"><b>{fmtNum(hours * o.credit_multiplier)}</b> kr</div>
              </div>
            );
          })}
          <div className="flex justify-end">
            <Button onClick={submit} disabled={confirmAtt.isPending}>
              {confirmAtt.isPending ? <Spinner /> : <Check />} {records.data?.length ? "Uložit opravu" : "Potvrdit účast a připsat kredity"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
