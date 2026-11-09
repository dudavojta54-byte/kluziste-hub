"use client";

import { Award, Clock, Download, Lock, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { LoadingList, SectionTitle, StatCard, ToneBadge, TypeDot } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTENDANCE_STATUS, BONUS_REASON, REWARD_MODEL } from "@/lib/constants";
import { fmtDate, fmtHours, fmtMoney, fmtNum, fmtTimeRange } from "@/lib/format";
import { useStatement } from "@/lib/queries";

export function StatementView({ userId, period }: { userId: string; period: string }) {
  const { data: s, isLoading, error } = useStatement(userId, period);
  if (isLoading) return <LoadingList rows={3} />;
  if (error || !s) return <p className="text-sm text-destructive">{error?.message ?? "Výkaz se nepodařilo načíst."}</p>;

  const formula =
    s.model === "credit" ? `${fmtNum(s.total_credits)} kr × ${fmtMoney(s.credit_rate)}`
    : s.model === "hourly" ? `${fmtNum(s.hours)} h × ${fmtMoney(s.hourly_rate)}`
    : s.model === "fixed" ? "Fixní měsíční odměna" : "Model odměny není nastaven";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {s.closed ? <ToneBadge tone="success"><Lock className="size-3" /> Uzavřený výkaz</ToneBadge> : <ToneBadge tone="warning">Předběžný – měsíc není uzavřen</ToneBadge>}
        {s.model && <ToneBadge tone="info">{REWARD_MODEL[s.model].label}</ToneBadge>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=csv&user=${userId}`} />}><Download /> CSV</Button>
          <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=pdf&user=${userId}`} />}><Download /> PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Odpracované hodiny" icon={Clock} value={fmtHours(s.hours)} hint={`${s.lessons} dokončených lekcí`} />
        <StatCard label="Kredity za lekce" icon={Sparkles} value={fmtNum(s.lesson_credits)} />
        <StatCard label="Bonusové kredity" icon={Award} value={fmtNum(s.bonus_credits)} hint={s.bonus_amount > 0 ? `+ ${fmtMoney(s.bonus_amount)}` : undefined} />
        <StatCard accent label="Odměna celkem" icon={Wallet} value={fmtMoney(s.total_amount)} hint={formula} />
      </div>

      {s.monthly_credit_target ? (
        <Card className="gap-2 p-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Výkonnostní cíl {s.model === "fixed" && <span className="text-muted-foreground">(interní ukazatel, neovlivňuje fixní odměnu)</span>}</span>
            <span className="tabular-nums">{fmtNum(s.total_credits)} / {fmtNum(s.monthly_credit_target)} kr</span>
          </div>
          <Progress value={Math.min((s.total_credits / s.monthly_credit_target) * 100, 100)} />
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="gap-3 p-4 sm:p-5">
          <SectionTitle>Kredity podle programu</SectionTitle>
          {s.by_type.length === 0 ? <p className="text-sm text-muted-foreground">Žádné potvrzené lekce.</p> : (
            <ul className="space-y-2 text-sm">
              {s.by_type.map((t) => (
                <li key={t.lesson_type_id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><TypeDot color={t.color} />{t.name}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtHours(t.hours)} · <b className="text-foreground">{fmtNum(t.credits)}</b></span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 space-y-1 border-t pt-3 text-sm">
            <Row label="Základ odměny" value={fmtMoney(s.base_amount)} />
            <Row label="Finanční bonusy" value={fmtMoney(s.bonus_amount)} />
            <Row label="Celkem" value={fmtMoney(s.total_amount)} bold />
          </div>
        </Card>

        <Card className="gap-0 p-0 lg:col-span-2">
          <div className="p-4 pb-2 sm:p-5 sm:pb-2"><SectionTitle>Dokončené lekce</SectionTitle></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead><TableHead>Lekce</TableHead><TableHead>Účast</TableHead>
                  <TableHead className="text-right">Hodiny</TableHead><TableHead className="text-right">Kredity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(i.starts_at)}<div className="text-xs text-muted-foreground">{fmtTimeRange(i.starts_at, i.ends_at)}</div></TableCell>
                    <TableCell><Link href={`/lekce/${i.occurrence_id}`} className="font-medium hover:text-primary">{i.title}</Link><div className="text-xs text-muted-foreground">{i.lesson_type} · {i.location}</div></TableCell>
                    <TableCell className="text-xs">{ATTENDANCE_STATUS[i.status]}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(i.hours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(i.credits)}<div className="text-[11px] text-muted-foreground">×{fmtNum(i.credit_multiplier)}</div></TableCell>
                  </TableRow>
                ))}
                {s.bonuses.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{fmtDate(`${b.awarded_on}T12:00:00Z`)}</TableCell>
                    <TableCell><span className="flex items-center gap-1.5 font-medium"><Award className="size-3.5 text-primary" />{b.reason_text}</span><div className="text-xs text-muted-foreground">{BONUS_REASON[b.reason]}</div></TableCell>
                    <TableCell className="text-xs">Bonus</TableCell>
                    <TableCell className="text-right tabular-nums">{b.amount > 0 ? fmtMoney(b.amount) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.credits > 0 ? fmtNum(b.credits) : ""}</TableCell>
                  </TableRow>
                ))}
                {s.items.length + s.bonuses.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Za tento měsíc zatím nic.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span><span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
