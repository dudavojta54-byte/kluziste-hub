"use client";

import { Clock, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Spinner, ToneBadge, TypeDot } from "@/components/common";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { APPLICATION_STATUS, OCCURRENCE_STATUS } from "@/lib/constants";
import { fmtTimeRange, fmtWeekday, fmtDateShort } from "@/lib/format";
import { useMyApplications, useRpc } from "@/lib/queries";
import type { Application, OccurrenceFull } from "@/lib/types";
import { cn } from "@/lib/utils";

export function useMyApplicationMap() {
  const user = useUser();
  const { data } = useMyApplications(user.id);
  return useMemo(() => new Map((data ?? []).map((a) => [a.occurrence_id, a as Application])), [data]);
}

export function activeAssigned(o: OccurrenceFull) {
  return o.assignments.filter((a) => a.status === "active");
}

export function occurrenceRelation(o: OccurrenceFull, userId: string, app: Application | undefined) {
  const assigned = activeAssigned(o);
  const isMine = assigned.some((a) => a.user_id === userId);
  const free = Math.max(o.required_instructors - assigned.length, 0);
  const started = new Date(o.starts_at) <= new Date();
  const deadlinePassed = o.registration_deadline ? new Date(o.registration_deadline) < new Date() : false;
  const activeApp = app && ["pending", "waitlisted", "approved", "cancel_requested"].includes(app.status) ? app : undefined;
  const canApply =
    o.status === "scheduled" && o.registration_status === "open" && !started && !deadlinePassed &&
    !isMine && !activeApp && app?.status !== "rejected";
  return { assigned, isMine, free, canApply, activeApp, started, deadlinePassed };
}

export function ApplyButton({ occurrenceId, size = "default", className }: {
  occurrenceId: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const apply = useRpc<{ p_occurrence: string; p_note: string | null }, { status: string }>("apply_to_occurrence", {
    success: (r) => (r.status === "waitlisted" ? "Lekce je obsazená – jste v seznamu náhradníků." : "Přihláška odeslána ke schválení."),
  });
  return (
    <Button
      size={size}
      className={className}
      disabled={apply.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        apply.mutate({ p_occurrence: occurrenceId, p_note: null });
      }}
    >
      {apply.isPending && <Spinner />} Přihlásit se
    </Button>
  );
}

export function OccurrenceCard({
  occ,
  app,
  showApply = true,
  compact,
}: {
  occ: OccurrenceFull;
  app?: Application;
  showApply?: boolean;
  compact?: boolean;
}) {
  const user = useUser();
  const rel = occurrenceRelation(occ, user.id, app);
  const cancelled = occ.status === "cancelled";

  return (
    <Link
      href={`/lekce/${occ.id}`}
      className={cn(
        "group flex items-stretch gap-3 rounded-xl border bg-card p-3 transition-all hover:border-primary/40 hover:shadow-sm sm:p-4",
        cancelled && "opacity-60",
      )}
    >
      <div
        className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg text-center"
        style={{ backgroundColor: `${occ.lesson_type.color}18`, color: occ.lesson_type.color }}
      >
        <span className="text-[11px] font-semibold uppercase">{fmtWeekday(occ.starts_at)}</span>
        <span className="font-[family-name:var(--font-display)] text-lg font-bold leading-tight">{fmtDateShort(occ.starts_at)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={cn("truncate font-semibold", cancelled && "line-through")}>{occ.title}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TypeDot color={occ.lesson_type.color} /> {occ.lesson_type.name}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {cancelled ? (
              <ToneBadge tone="destructive">{OCCURRENCE_STATUS.cancelled.label}</ToneBadge>
            ) : rel.isMine ? (
              <ToneBadge tone="success">Moje lekce</ToneBadge>
            ) : rel.activeApp ? (
              <ToneBadge tone={APPLICATION_STATUS[rel.activeApp.status].tone}>{APPLICATION_STATUS[rel.activeApp.status].label}</ToneBadge>
            ) : occ.status === "completed" ? (
              <ToneBadge tone="muted">Proběhlo</ToneBadge>
            ) : rel.free > 0 ? (
              <ToneBadge tone="info">{rel.free} {rel.free === 1 ? "volné místo" : rel.free < 5 ? "volná místa" : "volných míst"}</ToneBadge>
            ) : (
              <ToneBadge tone="muted">Obsazeno</ToneBadge>
            )}
          </div>
        </div>
        <div className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground", compact && "text-xs")}>
          <span className="flex items-center gap-1"><Clock className="size-3.5" />{fmtTimeRange(occ.starts_at, occ.ends_at)}</span>
          <span className="flex items-center gap-1"><MapPin className="size-3.5" />{occ.location.name}</span>
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />{rel.assigned.length}/{occ.required_instructors}
          </span>
        </div>
        {showApply && rel.canApply && (
          <div className="mt-3">
            <ApplyButton occurrenceId={occ.id} size="sm" className="w-full sm:w-auto" />
          </div>
        )}
      </div>
    </Link>
  );
}
