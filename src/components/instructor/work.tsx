"use client";

import { CalendarClock, Check, ClipboardCheck, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Field, NativeSelect, Spinner, ToneBadge, TypeDot } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AVAILABILITY_DEADLINE_WEEKDAY } from "@/lib/constants";
import { addDays, isoWeekday, startOfWeek, todayPrague } from "@/lib/dates";
import { durationHours, fmtDate, fmtDateShort, fmtMoney, fmtTimeRange, fmtWeekday } from "@/lib/format";
import { rateOf, useAvailability, useCreditValue, useLessonTypes, useLocations, useMyLessonsToReport, useRpc, useWorkReports } from "@/lib/queries";
import type { OccurrenceFull, WorkReport } from "@/lib/types";

// ------------------------------------------------------------------ vykázání odučeného času
export function ReportWorkForm({ occ, report, compact }: { occ: OccurrenceFull; report?: WorkReport; compact?: boolean }) {
  const planned = durationHours(occ.starts_at, occ.ends_at);
  const [hours, setHours] = useState(String(report?.hours ?? planned).replace(".", ","));
  const [note, setNote] = useState(report?.note ?? "");
  const submit = useRpc<{ p_occurrence: string; p_hours: number; p_note: string | null }>("submit_work_report", {
    success: "Odučený čas vykázán. Správce ho schválí.",
  });
  const value = Number(hours.replace(",", "."));
  return (
    <div className={compact ? "flex flex-wrap items-end gap-2" : "grid gap-2 sm:grid-cols-[110px_1fr_auto] sm:items-end"}>
      <Field label="Odučeno (h)">
        <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className="w-full sm:w-28" />
      </Field>
      {!compact && (
        <Field label="Poznámka (nepovinné)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. lekce se protáhla" />
        </Field>
      )}
      <Button disabled={submit.isPending || !(value > 0 && value <= 16)}
        onClick={() => submit.mutate({ p_occurrence: occ.id, p_hours: value, p_note: note || null })}>
        {submit.isPending ? <Spinner /> : <Check />} {report ? "Upravit" : "Vykázat"}
      </Button>
    </div>
  );
}

/** Proběhlé lekce, které čekají na vykázání / schválení */
export function LessonsToReport() {
  const user = useUser();
  const lessons = useMyLessonsToReport(user.id);
  const reports = useWorkReports();
  const creditValue = useCreditValue();
  const list = lessons.data ?? [];
  if (lessons.isLoading || list.length === 0) return null;
  const rate = (o: OccurrenceFull) => rateOf(o.credit_multiplier, creditValue);

  return (
    <Card className="gap-3 border-primary/40 bg-primary/5 p-4 sm:p-5">
      <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-5 text-primary" /> K vykázání</div>
      <ul className="space-y-3">
        {list.map((o) => {
          const report = reports.data?.find((r) => r.occurrence_id === o.id && r.user_id === user.id);
          return (
            <li key={o.id} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Link href={`/lekce/${o.id}`} className="min-w-0 hover:text-primary">
                  <div className="flex items-center gap-2 font-medium"><TypeDot color={o.lesson_type.color} />{o.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtWeekday(o.starts_at)} {fmtDateShort(o.starts_at)} · {fmtTimeRange(o.starts_at, o.ends_at)} · {o.location.name} · {fmtMoney(rate(o))}/h
                  </div>
                </Link>
                {report && <ToneBadge tone="warning">Vykázáno {String(report.hours).replace(".", ",")} h · čeká na schválení</ToneBadge>}
              </div>
              <ReportWorkForm occ={o} report={report} compact />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ vlastní klient
export function OwnClientDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const locations = useLocations();
  const types = useLessonTypes();
  const creditValue = useCreditValue();
  const own = types.data?.find((t) => t.code === "individual_own");
  const rate = own ? rateOf(own.credit_multiplier, creditValue) : null;
  const [f, setF] = useState({ date: todayPrague(), start: "16:00", end: "17:00", location: "", note: "" });
  const create = useRpc<{ p_date: string; p_start: string; p_end: string; p_location: string; p_note: string | null }>("create_own_lesson", {
    success: "Lekce zapsána do tvého rozvrhu. Po jejím skončení ji vykážeš.",
  });
  const valid = f.location && f.date && f.end > f.start;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : (
        <Button variant="outline" onClick={() => setOpen(true)}><UserPlus /> Vlastní klient</Button>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Individuální lekce s vlastním klientem</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Klienta jsi získal(a) sám/sama. Odměna {rate ? `${fmtMoney(rate)} za hodinu` : "podle programu"}. Lekce se ti zapíše do rozvrhu a správce dostane upozornění.
        </p>
        <div className="grid gap-3">
          <Field label="Datum"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Od"><Input type="time" step={300} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="Do"><Input type="time" step={300} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
          <Field label="Kluziště">
            <NativeSelect value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
              <option value="">Vyberte…</option>
              {locations.data?.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Poznámka (např. jméno klienta)"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button disabled={!valid || create.isPending}
            onClick={() => create.mutateAsync({ p_date: f.date, p_start: f.start, p_end: f.end, p_location: f.location, p_note: f.note || null })
              .then(() => { setOpen(false); setF({ ...f, note: "" }); }).catch(() => {})}>
            {create.isPending ? <Spinner /> : <Plus />} Zapsat lekci
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ dostupnost na příští týden
export function nextWeekRange() {
  const from = addDays(startOfWeek(todayPrague()), 7);
  return { from, to: addDays(from, 6) };
}

export function AvailabilityReminder() {
  const user = useUser();
  const avail = useAvailability(user.id);
  if (avail.isLoading) return null;
  const { from, to } = nextWeekRange();
  const filled = (avail.data ?? []).some((a) => a.weekday != null || (a.date && a.date >= from && a.date <= to));
  if (filled) return null;
  const late = isoWeekday(todayPrague()) > AVAILABILITY_DEADLINE_WEEKDAY;
  const deadline = addDays(startOfWeek(todayPrague()), AVAILABILITY_DEADLINE_WEEKDAY - 1);
  return (
    <Card className={`flex-row flex-wrap items-center gap-3 p-4 ${late ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/8"}`}>
      <CalendarClock className={`size-5 ${late ? "text-destructive" : "text-warning"}`} />
      <div className="min-w-0 flex-1 text-sm">
        <b>Nahlas dostupnost na příští týden</b> ({fmtDate(`${from}T12:00:00Z`)} – {fmtDate(`${to}T12:00:00Z`)}).{" "}
        {late ? "Termín byl ve středu – vyplň dostupnost co nejdřív." : `Termín: středa ${fmtDate(`${deadline}T12:00:00Z`)}.`}
      </div>
      <Button size="sm" render={<Link href="/dostupnost" />}>Vyplnit</Button>
    </Card>
  );
}
