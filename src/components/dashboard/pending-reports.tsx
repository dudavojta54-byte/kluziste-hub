"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Spinner, TypeDot, UserAvatar } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { durationHours, fmtDateShort, fmtMoney, fmtNum, fmtTimeRange, fullName } from "@/lib/format";
import { rateOf, useCreditValue, useProfilesById } from "@/lib/queries";
import { getSupabase } from "@/lib/supabase/client";

interface PendingRow {
  id: string;
  assignment_id: string;
  occurrence_id: string;
  user_id: string;
  hours: number;
  note: string | null;
  occurrence: { title: string; starts_at: string; ends_at: string; credit_multiplier: number; lesson_type: { name: string; color: string } };
}

/** Vykázaný čas instruktorů čekající na schválení správcem */
export function PendingReports() {
  const user = useUser();
  const qc = useQueryClient();
  const { map } = useProfilesById();
  const [busy, setBusy] = useState<string | null>(null);
  const creditValue = useCreditValue();
  const q = useQuery({
    queryKey: ["work_reports", "pending_full"],
    enabled: user.isAdmin,
    queryFn: async () => {
      const { data, error } = await getSupabase().from("work_reports")
        .select("id, assignment_id, occurrence_id, user_id, hours, note, occurrence:lesson_occurrences(title, starts_at, ends_at, credit_multiplier, lesson_type:lesson_types(name, color))")
        .eq("status", "submitted").order("created_at");
      if (error) throw new Error(error.message);
      return data as unknown as PendingRow[];
    },
  });
  const rows = q.data ?? [];
  if (!user.isAdmin || rows.length === 0) return null;

  const approve = async (list: PendingRow[]) => {
    setBusy(list.length === 1 ? list[0].id : "all");
    let ok = 0;
    for (const r of list) {
      const { error } = await getSupabase().rpc("confirm_attendance", {
        p_occurrence: r.occurrence_id, p_entries: [{ assignment_id: r.assignment_id }],
      });
      if (error) toast.error(`${fullName(map.get(r.user_id))}: ${error.message}`); else ok++;
    }
    setBusy(null);
    if (ok) toast.success(ok === 1 ? "Schváleno." : `Schváleno ${ok} vykázání.`);
    for (const k of [["work_reports"], ["dashboard"], ["statement"], ["team_overview"], ["occurrences"]]) qc.invalidateQueries({ queryKey: k });
  };

  return (
    <Card className="gap-3 border-primary/40 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-5 text-primary" /> Vykázaný čas ke schválení ({rows.length})</div>
        {rows.length > 1 && (
          <Button size="sm" disabled={!!busy} onClick={() => approve(rows)}>
            {busy === "all" ? <Spinner /> : <CheckCheck />} Schválit vše
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((r) => {
          const planned = durationHours(r.occurrence.starts_at, r.occurrence.ends_at);
          const differs = Math.abs(Number(r.hours) - planned) > 0.01;
          return (
            <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar profile={map.get(r.user_id)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{fullName(map.get(r.user_id))}</div>
                  <Link href={`/lekce/${r.occurrence_id}#dochazka`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                    <TypeDot color={r.occurrence.lesson_type.color} />
                    {fmtDateShort(r.occurrence.starts_at)} {fmtTimeRange(r.occurrence.starts_at, r.occurrence.ends_at)} · {r.occurrence.title}
                  </Link>
                  {r.note && <div className="text-xs italic text-muted-foreground">„{r.note}“</div>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm tabular-nums">
                  <b className={differs ? "text-warning" : ""}>{fmtNum(r.hours)} h</b>
                  {differs && <span className="text-xs text-muted-foreground"> (plán {fmtNum(planned)} h)</span>}
                  <div className="text-xs text-muted-foreground">{fmtMoney(Number(r.hours) * rateOf(r.occurrence.credit_multiplier, creditValue))}</div>
                </div>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => approve([r])}>
                  {busy === r.id ? <Spinner /> : <Check />} Schválit
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Úpravu hodin nebo nepřítomnost zadáte v detailu lekce (odkaz u lekce).</p>
    </Card>
  );
}
