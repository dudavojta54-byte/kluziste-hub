"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, Field, MonthPicker, NativeSelect, PageHeader, SectionTitle, ToneBadge, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AVAILABILITY_KIND, WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/constants";
import { isoWeekday, monthGrid, startOfMonth, todayPrague } from "@/lib/dates";
import { fmtDayLong, fullName } from "@/lib/format";
import { useAvailability, useTableMutation, useTeam } from "@/lib/queries";
import type { Availability, AvailabilityKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const CYCLE: (AvailabilityKind | null)[] = [null, "available", "preferred", "unavailable"];
const KIND_BG: Record<AvailabilityKind, string> = {
  available: "bg-success/20 text-success border-success/40",
  preferred: "bg-primary/20 text-primary border-primary/40",
  unavailable: "bg-destructive/15 text-destructive border-destructive/40",
};

export default function AvailabilityPage() {
  const user = useUser();
  const [tab, setTab] = useState<"mine" | "team">("mine");
  return (
    <>
      <PageHeader title="Dostupnost" description="Kdy můžete a chcete pracovat – podle toho koordinátor navrhuje obsazení." />
      {user.isStaff && (
        <div className="mb-4 flex w-fit rounded-lg bg-muted p-0.5">
          {([["mine", "Moje dostupnost"], ["team", "Dostupnost týmu"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      )}
      {tab === "mine" ? <MyAvailability /> : <TeamAvailability />}
    </>
  );
}

function MyAvailability() {
  const user = useUser();
  const [month, setMonth] = useState(startOfMonth(todayPrague()));
  const avail = useAvailability(user.id);
  const save = useTableMutation<{ date: string; kind: AvailabilityKind | null; existing?: Availability }>(
    async (sb, { date, kind, existing }) => {
      if (existing) {
        if (!kind) return sb.from("availability").delete().eq("id", existing.id);
        return sb.from("availability").update({ kind }).eq("id", existing.id);
      }
      return sb.from("availability").insert({ user_id: user.id, date, kind });
    },
    { invalidate: [["availability"], ["suggestions"]] },
  );
  const addRecurring = useTableMutation<{ weekday: number; kind: AvailabilityKind; start_time: string | null; end_time: string | null }>(
    (sb, v) => sb.from("availability").insert({ user_id: user.id, ...v }),
    { invalidate: [["availability"]], success: "Pravidelná dostupnost uložena." },
  );
  const remove = useTableMutation<string>((sb, id) => sb.from("availability").delete().eq("id", id), { invalidate: [["availability"]] });

  const byDate = useMemo(() => new Map((avail.data ?? []).filter((a) => a.date && !a.start_time).map((a) => [a.date!, a])), [avail.data]);
  const recurring = (avail.data ?? []).filter((a) => a.weekday != null);
  const [rec, setRec] = useState({ weekday: 1, kind: "available" as AvailabilityKind, start_time: "", end_time: "" });
  const today = todayPrague();

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="gap-3 p-4 sm:p-5 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Konkrétní dny</h2>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
        <p className="text-xs text-muted-foreground">Klepnutím na den přepínáte: mohu → preferuji → nemohu → nevyplněno.</p>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS_SHORT.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthGrid(month).map((d) => {
            const a = byDate.get(d);
            const inMonth = d.slice(0, 7) === month.slice(0, 7);
            const rule = recurring.find((r) => r.weekday === isoWeekday(d) && !r.start_time);
            const past = d < today;
            return (
              <button key={d} disabled={past || !inMonth || save.isPending}
                onClick={() => {
                  const next = CYCLE[(CYCLE.indexOf(a?.kind ?? null) + 1) % CYCLE.length];
                  save.mutate({ date: d, kind: next, existing: a });
                }}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                  !inMonth && "invisible",
                  past && "opacity-40",
                  a ? KIND_BG[a.kind] : rule ? `${KIND_BG[rule.kind]} border-dashed opacity-60` : "hover:bg-muted",
                  d === today && "ring-2 ring-primary",
                )}>
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(AVAILABILITY_KIND).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5"><span className={cn("size-3 rounded border", KIND_BG[k as AvailabilityKind])} />{v.label}</span>
          ))}
          <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-3 rounded border border-dashed" />z pravidelné dostupnosti</span>
        </div>
      </Card>

      <Card className="gap-3 p-4 sm:p-5 lg:col-span-2">
        <SectionTitle>Pravidelná dostupnost</SectionTitle>
        {recurring.length === 0 ? <p className="text-sm text-muted-foreground">Např. „každé úterý odpoledne mohu“.</p> : (
          <ul className="divide-y">
            {recurring.sort((a, b) => a.weekday! - b.weekday!).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><b>{WEEKDAYS[r.weekday! - 1]}</b>{r.start_time ? ` ${r.start_time.slice(0, 5)}–${r.end_time?.slice(0, 5)}` : " celý den"}</span>
                <span className="flex items-center gap-2">
                  <ToneBadge tone={AVAILABILITY_KIND[r.kind].tone}>{AVAILABILITY_KIND[r.kind].label}</ToneBadge>
                  <Button variant="ghost" size="icon-sm" aria-label="Smazat" onClick={() => remove.mutate(r.id)}><Trash2 /></Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2 border-t pt-3">
          <Field label="Den">
            <NativeSelect value={rec.weekday} onChange={(e) => setRec({ ...rec, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Typ">
            <NativeSelect value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as AvailabilityKind })}>
              {Object.entries(AVAILABILITY_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Od (nepovinné)"><Input type="time" value={rec.start_time} onChange={(e) => setRec({ ...rec, start_time: e.target.value })} /></Field>
          <Field label="Do"><Input type="time" value={rec.end_time} onChange={(e) => setRec({ ...rec, end_time: e.target.value })} /></Field>
          <Button className="col-span-2" variant="outline" disabled={addRecurring.isPending || (!!rec.start_time !== !!rec.end_time)}
            onClick={() => addRecurring.mutate({ weekday: rec.weekday, kind: rec.kind, start_time: rec.start_time || null, end_time: rec.end_time || null })}>
            <Plus /> Přidat pravidlo
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TeamAvailability() {
  const [date, setDate] = useState(todayPrague());
  const [kind, setKind] = useState<"" | AvailabilityKind | "none">("");
  const team = useTeam();
  const avail = useAvailability();
  const dow = isoWeekday(date);

  const rows = (team.data ?? [])
    .filter((p) => p.is_active && p.roles.includes("instructor"))
    .map((p) => {
      const mine = (avail.data ?? []).filter((a) => a.user_id === p.id);
      const specific = mine.filter((a) => a.date === date);
      const weekly = mine.filter((a) => a.weekday === dow);
      const rules = specific.length ? specific : weekly;
      const k = rules.find((r) => r.kind === "unavailable")?.kind ?? rules.find((r) => r.kind === "preferred")?.kind ?? rules[0]?.kind ?? null;
      return { p, kind: k as AvailabilityKind | null, rules };
    })
    .filter((r) => !kind || (kind === "none" ? !r.kind : r.kind === kind))
    .sort((a, b) => order(a.kind) - order(b.kind));

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Datum"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Filtr">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Všichni</option>
            {Object.entries(AVAILABILITY_KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="none">Nevyplněno</option>
          </NativeSelect>
        </Field>
        <span className="pb-2 text-sm capitalize text-muted-foreground">{fmtDayLong(`${date}T12:00:00Z`)}</span>
      </div>
      {rows.length === 0 ? <EmptyState title="Nikdo neodpovídá filtru" /> : (
        <ul className="divide-y">
          {rows.map(({ p, kind, rules }) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <UserAvatar profile={p} />
              <div className="flex-1">
                <div className="text-sm font-medium">{fullName(p)}</div>
                {rules.some((r) => r.start_time) && (
                  <div className="text-xs text-muted-foreground">{rules.filter((r) => r.start_time).map((r) => `${r.start_time!.slice(0, 5)}–${r.end_time!.slice(0, 5)}`).join(", ")}</div>
                )}
              </div>
              {kind ? <ToneBadge tone={AVAILABILITY_KIND[kind].tone}>{AVAILABILITY_KIND[kind].label}</ToneBadge> : <ToneBadge tone="muted">Nevyplněno</ToneBadge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const order = (k: AvailabilityKind | null) => (k === "preferred" ? 0 : k === "available" ? 1 : k === null ? 2 : 3);
