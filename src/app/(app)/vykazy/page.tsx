"use client";

import { Award, Lock, LockOpen, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Field, LoadingList, MonthPicker, NativeSelect, PageHeader, SectionTitle, Spinner, ToneBadge } from "@/components/common";
import { TeamTable } from "@/components/dashboard/team-table";
import { useUser } from "@/components/providers";
import { StatementView } from "@/components/reports/statement-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BONUS_REASON, REWARD_MODEL } from "@/lib/constants";
import { startOfMonth, todayPrague } from "@/lib/dates";
import { fmtDate, fmtMoney, fmtMonth, fmtNum, fullName } from "@/lib/format";
import { usePeriodStatus, useRewardSettings, useRpc, useTableMutation, useTeam } from "@/lib/queries";
import type { BonusReason, RewardModel } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
  return <Suspense fallback={<LoadingList />}><Reports /></Suspense>;
}

function Reports() {
  const user = useUser();
  const params = useSearchParams();
  const router = useRouter();
  const period = params.get("obdobi") ?? startOfMonth(todayPrague());
  const selected = params.get("instruktor");
  const tab = params.get("pohled") ?? (user.isAdmin ? (selected ? "instruktor" : "tym") : "muj");

  const nav = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v === null) sp.delete(k); else sp.set(k, v);
    router.replace(`/vykazy?${sp.toString()}`);
  };

  const tabs = [
    ...(user.isInstructor || !user.isStaff ? [["muj", "Můj výkaz"]] : []),
    ...(user.isStaff ? [["tym", "Tým"]] : []),
    ...(user.isAdmin ? [["instruktor", "Výkaz instruktora"]] : []),
  ] as [string, string][];

  return (
    <>
      <PageHeader
        title="Výkazy a odměny"
        description="Skutečně odpracované hodiny, výkonové kredity a finanční odměny – evidované odděleně."
        actions={<MonthPicker value={period} onChange={(p) => nav({ obdobi: p })} />}
      />
      {tabs.length > 1 && (
        <div className="mb-5 flex w-fit gap-1 rounded-lg bg-muted p-0.5">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => nav({ pohled: k })}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === k ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      )}

      {tab === "muj" && <StatementView userId={user.id} period={period} />}
      {tab === "tym" && user.isStaff && (
        <div className="space-y-4">
          {user.isAdmin && <PeriodControls period={period} />}
          <TeamTable period={period} onPeriodChange={(p) => nav({ obdobi: p })} showExport />
        </div>
      )}
      {tab === "instruktor" && user.isAdmin && <InstructorAdmin period={period} selected={selected} onSelect={(id) => nav({ instruktor: id })} />}
    </>
  );
}

function PeriodControls({ period }: { period: string }) {
  const status = usePeriodStatus(period);
  const close = useRpc<{ p_period: string }, number>("close_period", {
    invalidate: [["period_status"], ["statement"], ["team_overview"]],
    success: (n) => `Měsíc uzavřen, uloženo ${n} výkazů.`,
  });
  const reopen = useRpc<{ p_period: string; p_reason: string }>("reopen_period", {
    invalidate: [["period_status"], ["statement"], ["team_overview"]],
    success: "Měsíc znovu otevřen.",
  });
  const closed = status.data === "closed";
  return (
    <Card className="flex-row flex-wrap items-center gap-3 p-4">
      <div className="flex items-center gap-2">
        {closed ? <Lock className="size-5 text-success" /> : <LockOpen className="size-5 text-muted-foreground" />}
        <div>
          <div className="font-semibold">{fmtMonth(period)}</div>
          <div className="text-xs text-muted-foreground">{closed ? "Výkaz je uzavřen – data jsou zamčena a odměny zafixovány." : "Otevřený měsíc – docházku a bonusy lze upravovat."}</div>
        </div>
      </div>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=csv&detail=1`} />}>CSV detail</Button>
        <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=pdf&detail=1`} />}>PDF detail</Button>
        {closed ? (
          <Button variant="outline" size="sm" disabled={reopen.isPending}
            onClick={() => { const r = prompt("Důvod znovuotevření (bude uložen v auditu):"); if (r) reopen.mutate({ p_period: period, p_reason: r }); }}>
            <LockOpen /> Znovu otevřít
          </Button>
        ) : (
          <Button size="sm" disabled={close.isPending}
            onClick={() => confirm(`Uzavřít ${fmtMonth(period)}? Docházku, kredity a bonusy pak nepůjde měnit.`) && close.mutate({ p_period: period })}>
            {close.isPending ? <Spinner /> : <Lock />} Uzavřít měsíc
          </Button>
        )}
      </div>
    </Card>
  );
}

function InstructorAdmin({ period, selected, onSelect }: { period: string; selected: string | null; onSelect: (id: string) => void }) {
  const team = useTeam();
  const instructors = (team.data ?? []).filter((p) => p.roles.includes("instructor"));
  const current = selected ?? instructors[0]?.id;
  const person = instructors.find((p) => p.id === current);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Instruktor" className="sm:w-72">
          <NativeSelect value={current ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {instructors.map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.is_active ? "" : " (neaktivní)"}</option>)}
          </NativeSelect>
        </Field>
        {current && (
          <div className="flex gap-2">
            <BonusDialog userId={current} name={fullName(person)} />
            <RewardDialog userId={current} name={fullName(person)} />
          </div>
        )}
      </div>
      {current && <StatementView userId={current} period={period} />}
      {current && <RewardHistory userId={current} />}
    </div>
  );
}

function BonusDialog({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ reason: "quality" as BonusReason, text: "", date: todayPrague(), credits: "", amount: "" });
  const add = useRpc<Record<string, unknown>>("add_bonus", { success: "Bonus přidělen a instruktor upozorněn." });
  const valid = f.text.trim().length >= 2 && (Number(f.credits) > 0 || Number(f.amount) > 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Award /> Přidat bonus</Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Bonus pro {name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Důvod">
            <NativeSelect value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as BonusReason })}>
              {Object.entries(BONUS_REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Popis"><Textarea rows={2} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="např. Záskok 12. 12. za nemocnou kolegyni" /></Field>
          <Field label="Datum"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bonusové kredity"><Input inputMode="decimal" value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} placeholder="0" /></Field>
            <Field label="Finanční odměna (Kč)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0" /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button disabled={!valid || add.isPending} onClick={() => add.mutateAsync({
            p_user: userId, p_reason: f.reason, p_reason_text: f.text.trim(), p_awarded_on: f.date,
            p_credits: Number(f.credits.replace(",", ".")) || 0, p_amount: Number(f.amount.replace(",", ".")) || 0,
          }).then(() => { setOpen(false); setF({ ...f, text: "", credits: "", amount: "" }); }).catch(() => {})}>
            {add.isPending && <Spinner />} Přidělit bonus
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RewardDialog({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ model: "credit" as RewardModel, credit_rate: "", hourly_rate: "", fixed_amount: "", target: "", valid_from: startOfMonth(todayPrague()), note: "" });
  const save = useTableMutation<typeof f>(
    (sb, v) => sb.from("reward_settings").upsert({
      user_id: userId, model: v.model,
      credit_rate: Number(v.credit_rate) || 0, hourly_rate: Number(v.hourly_rate) || 0, fixed_amount: Number(v.fixed_amount) || 0,
      monthly_credit_target: v.target ? Number(v.target) : null, valid_from: v.valid_from, note: v.note || null,
    }, { onConflict: "user_id,valid_from" }),
    { invalidate: [["reward_settings"], ["statement"], ["team_overview"], ["dashboard"]], success: "Nastavení odměny uloženo." },
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}><Wallet /> Model odměny</Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Odměňování – {name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            {(Object.keys(REWARD_MODEL) as RewardModel[]).map((m) => (
              <button key={m} type="button" onClick={() => setF({ ...f, model: m })}
                className={cn("rounded-lg border p-3 text-left", f.model === m ? "border-primary bg-primary/8" : "hover:bg-muted")}>
                <div className="text-sm font-medium">{REWARD_MODEL[m].label}</div>
                <div className="text-xs text-muted-foreground">{REWARD_MODEL[m].description}</div>
              </button>
            ))}
          </div>
          {f.model === "credit" && <Field label="Cena kreditu (Kč)"><Input inputMode="decimal" value={f.credit_rate} onChange={(e) => setF({ ...f, credit_rate: e.target.value })} /></Field>}
          {f.model === "hourly" && <Field label="Hodinová sazba (Kč)"><Input inputMode="decimal" value={f.hourly_rate} onChange={(e) => setF({ ...f, hourly_rate: e.target.value })} /></Field>}
          {f.model === "fixed" && <Field label="Fixní měsíční odměna (Kč)"><Input inputMode="decimal" value={f.fixed_amount} onChange={(e) => setF({ ...f, fixed_amount: e.target.value })} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Měsíční cíl (kredity)"><Input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="nepovinné" /></Field>
            <Field label="Platí od"><Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
          </div>
          <Field label="Poznámka"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button disabled={save.isPending} onClick={() => save.mutateAsync(f).then(() => setOpen(false)).catch(() => {})}>{save.isPending && <Spinner />} Uložit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RewardHistory({ userId }: { userId: string }) {
  const rs = useRewardSettings(userId);
  if (!rs.data?.length) return null;
  return (
    <Card className="gap-2 p-4 sm:p-5">
      <SectionTitle>Historie nastavení odměny</SectionTitle>
      <ul className="divide-y text-sm">
        {rs.data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>od <b>{fmtDate(`${r.valid_from}T12:00:00Z`)}</b> · {REWARD_MODEL[r.model].label}</span>
            <span className="text-muted-foreground">
              {r.model === "credit" && `${fmtMoney(r.credit_rate)} / kredit`}
              {r.model === "hourly" && `${fmtMoney(r.hourly_rate)} / hod`}
              {r.model === "fixed" && `${fmtMoney(r.fixed_amount)} / měsíc`}
              {r.monthly_credit_target ? ` · cíl ${fmtNum(r.monthly_credit_target)} kr` : ""}
            </span>
            {r.note && <ToneBadge tone="muted">{r.note}</ToneBadge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
