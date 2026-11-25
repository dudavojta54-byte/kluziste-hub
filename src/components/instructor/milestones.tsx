"use client";

import { Check, Gift } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SectionTitle, Spinner, ToneBadge } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtDateShort, fmtNum } from "@/lib/format";
import { useMilestoneOverview, useMyMilestones, useRpc } from "@/lib/queries";
import { cn } from "@/lib/utils";

const seasonLabel = (season: string) => {
  const y = Number(season.slice(0, 4));
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
};

/** Instruktor: postup k odměnám za odpracované hodiny */
export function MilestoneProgress() {
  const q = useMyMilestones();
  const d = q.data;
  if (!d || d.milestones.length === 0) return null;
  const hours = Number(d.hours);
  const next = d.milestones.find((m) => !m.reached_at);
  const prevHours = [...d.milestones].reverse().find((m) => m.reached_at)?.hours ?? 0;
  const pct = next ? Math.min(100, ((hours - prevHours) / (Number(next.hours) - prevHours)) * 100) : 100;

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionTitle action={<span className="text-xs text-muted-foreground">sezóna {seasonLabel(d.season)}</span>}>
        <span className="flex items-center gap-2"><Gift className="size-5 text-primary" /> Odměny za odpracované hodiny</span>
      </SectionTitle>
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span><b className="text-2xl tabular-nums">{fmtNum(hours)}</b> h v této sezóně</span>
          {next && <span className="text-muted-foreground">do další odměny {fmtNum(Math.max(0, Number(next.hours) - hours))} h</span>}
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
        {next && <div className="mt-1.5 text-sm">Další: <span className="mr-1">{next.icon}</span><b>{next.title}</b> za {fmtNum(next.hours)} h</div>}
        {!next && <div className="mt-1.5 text-sm font-medium text-success">Máš všechny odměny této sezóny. Děkujeme!</div>}
      </div>
      <ul className="grid grid-cols-1 gap-1.5 text-sm">
        {d.milestones.map((m) => (
          <li key={m.id} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", m.reached_at ? "bg-success/8" : "opacity-60")}>
            <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{fmtNum(m.hours)} h</span>
            <span className="text-lg leading-none">{m.icon}</span>
            <span className="min-w-0 flex-1 truncate" title={m.description ?? undefined}>{m.title}</span>
            {m.handed_at ? <ToneBadge tone="success">Předáno</ToneBadge>
              : m.reached_at ? <ToneBadge tone="warning">Čeká na předání</ToneBadge> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Správce: odměny k předání */
export function MilestonesToHand() {
  const user = useUser();
  const q = useMilestoneOverview(user.isStaff);
  const [busy, setBusy] = useState<string | null>(null);
  const hand = useRpc<{ p_award: string; p_handed: boolean }>("hand_over_milestone", { invalidate: [["milestones"]], success: "Označeno jako předané." });
  const rows = q.data?.to_hand ?? [];
  if (!user.isStaff || rows.length === 0) return null;
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionTitle action={user.isAdmin ? <Link href="/sprava" className="text-sm text-primary hover:underline">Nastavit odměny</Link> : undefined}>
        <span className="flex items-center gap-2"><Gift className="size-5 text-primary" /> Odměny za hodiny k předání ({rows.length})</span>
      </SectionTitle>
      <ul className="divide-y text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <span className="text-xl">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <div><b>{r.name}</b> · {r.title}</div>
              <div className="text-xs text-muted-foreground">{fmtNum(r.hours)} h dosaženo {fmtDateShort(r.reached_at)}</div>
            </div>
            {user.isAdmin && (
              <Button size="sm" variant="outline" disabled={!!busy}
                onClick={() => { setBusy(r.id); hand.mutateAsync({ p_award: r.id, p_handed: true }).catch(() => {}).finally(() => setBusy(null)); }}>
                {busy === r.id ? <Spinner /> : <Check />} Předáno
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
