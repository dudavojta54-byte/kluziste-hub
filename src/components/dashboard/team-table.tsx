"use client";

import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadingList, MonthPicker, NativeSelect, ToneBadge, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REWARD_MODEL } from "@/lib/constants";
import { fmtHours, fmtMoney, fmtNum, fullName } from "@/lib/format";
import { useLessonTypes, useLocations, useTeamOverview } from "@/lib/queries";

export function TeamTable({ period, onPeriodChange, showExport }: {
  period: string;
  onPeriodChange: (p: string) => void;
  showExport?: boolean;
}) {
  const user = useUser();
  const [type, setType] = useState("");
  const [loc, setLoc] = useState("");
  const [q, setQ] = useState("");
  const types = useLessonTypes();
  const locations = useLocations();
  const data = useTeamOverview(period, type || null, loc || null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.data ?? []).filter((r) => !needle || fullName(r).toLowerCase().includes(needle));
  }, [data.data, q]);

  const totals = rows.reduce(
    (a, r) => ({
      hours: a.hours + Number(r.hours),
      credits: a.credits + Number(r.lesson_credits) + Number(r.bonus_credits),
      lessons: a.lessons + Number(r.confirmed_lessons),
      reward: a.reward + Number(r.reward ?? 0),
    }),
    { hours: 0, credits: 0, lessons: 0, reward: 0 },
  );
  const filtered = Boolean(type || loc);

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
        <MonthPicker value={period} onChange={onPeriodChange} />
        <div className="relative sm:w-48">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Instruktor…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
        </div>
        <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className="sm:w-48">
          <option value="">Všechny programy</option>
          {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
        <NativeSelect value={loc} onChange={(e) => setLoc(e.target.value)} className="sm:w-48">
          <option value="">Všechny lokality</option>
          {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </NativeSelect>
        {showExport && user.isAdmin && (
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=csv`} />}>
              <Download /> CSV
            </Button>
            <Button variant="outline" size="sm" render={<a href={`/api/export?period=${period}&format=pdf`} />}>
              <Download /> PDF
            </Button>
          </div>
        )}
      </div>
      {data.isLoading ? (
        <div className="p-4"><LoadingList rows={4} /></div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instruktor</TableHead>
                <TableHead className="text-right">Hodiny</TableHead>
                <TableHead className="text-right">Kredity</TableHead>
                <TableHead className="text-right">Potvrzené lekce</TableHead>
                {user.isAdmin && <TableHead className="text-right">Odhad odměny</TableHead>}
                <TableHead>Stav</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.user_id}>
                  <TableCell>
                    <Link href={user.isAdmin ? `/vykazy?instruktor=${r.user_id}&obdobi=${period}` : `/tym#${r.user_id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                      <UserAvatar profile={r} className="size-7" />
                      {fullName(r)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtHours(r.hours)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(Number(r.lesson_credits) + Number(r.bonus_credits))}
                    {Number(r.bonus_credits) > 0 && <span className="ml-1 text-xs text-muted-foreground">(+{fmtNum(r.bonus_credits)} b)</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.confirmed_lessons}</TableCell>
                  {user.isAdmin && (
                    <TableCell className="text-right tabular-nums">
                      {filtered ? "—" : fmtMoney(r.reward)}
                      {r.model && !filtered && <div className="text-[11px] text-muted-foreground">{REWARD_MODEL[r.model].label}</div>}
                    </TableCell>
                  )}
                  <TableCell>
                    {r.is_active ? <ToneBadge tone="success">Aktivní</ToneBadge> : <ToneBadge tone="muted">Neaktivní</ToneBadge>}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Žádní instruktoři.</TableCell></TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Celkem</TableCell>
                <TableCell className="text-right tabular-nums">{fmtHours(totals.hours)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(totals.credits)}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.lessons}</TableCell>
                {user.isAdmin && <TableCell className="text-right tabular-nums">{filtered ? "—" : fmtMoney(totals.reward)}</TableCell>}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
          {filtered && user.isAdmin && (
            <p className="px-4 pb-3 text-xs text-muted-foreground">Odměna se počítá za celý měsíc – při filtru programu nebo lokality se nezobrazuje.</p>
          )}
        </div>
      )}
    </Card>
  );
}
