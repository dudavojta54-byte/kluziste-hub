"use client";

import {
  AlertTriangle,
  CalendarPlus,
  ClipboardCheck,
  Clock,
  Inbox,
  Sparkles,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, LoadingList, PageHeader, SectionTitle, StatCard, ToneBadge, TypeDot } from "@/components/common";
import { TeamTable } from "@/components/dashboard/team-table";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { startOfMonth, todayPrague } from "@/lib/dates";
import { fmtDateTime, fmtDayLong, fmtHours, fmtMoney, fmtNum, fmtTimeRange, fmtDateShort } from "@/lib/format";
import { useAdminDashboard } from "@/lib/queries";
import type { DashboardOccurrence } from "@/lib/types";

const CONFLICT_LABEL = {
  unavailable: "označil(a) nedostupnost",
  overlap: "má čekající přihlášku v kolizi s potvrzenou lekcí",
  cancel_request: "žádá o zrušení účasti",
};

export function AdminDashboardView() {
  const user = useUser();
  const { data, isLoading } = useAdminDashboard();
  const [period, setPeriod] = useState(startOfMonth(todayPrague()));

  return (
    <>
      <PageHeader
        title="Provozní přehled"
        description={fmtDayLong(new Date())}
        actions={
          <>
            {user.isInstructor && <Button variant="outline" render={<Link href="/?pohled=osobni" />}>Můj osobní přehled</Button>}
            <Button render={<Link href="/lekce/nova" />}><CalendarPlus /> Nová lekce</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard accent label="Dnes lekcí" icon={ClipboardCheck} value={data?.today.length ?? "–"} />
        <StatCard label="Neobsazené" icon={AlertTriangle} value={data?.understaffed.length ?? "–"} hint="v příštích 14 dnech" />
        <StatCard label="Čekající přihlášky" icon={Inbox} value={data?.pending_applications ?? "–"} />
        <StatCard label="Aktivní instruktoři" icon={Users} value={data?.active_instructors ?? "–"} />
        <StatCard label="Hodiny (měsíc)" icon={Clock} value={fmtHours(data?.month_hours)} hint={`${fmtNum(data?.month_credits)} kreditů`} />
        {user.isAdmin ? (
          <StatCard label="Odhad nákladů" icon={Wallet} value={fmtMoney(data?.estimated_cost)} hint="aktuální měsíc" />
        ) : (
          <StatCard label="Kredity (měsíc)" icon={Sparkles} value={fmtNum(data?.month_credits)} />
        )}
      </div>

      {data && data.conflicts.length > 0 && (
        <Card className="mt-4 gap-2 border-warning/40 bg-warning/8 p-4">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-warning" /> Upozornění v rozvrhu</div>
          <ul className="space-y-1 text-sm">
            {data.conflicts.map((c, i) => (
              <li key={i}>
                <Link href={c.kind === "cancel_request" ? "/prihlasky" : `/lekce/${c.occurrence_id}`} className="hover:underline">
                  <b>{c.user_name}</b> {CONFLICT_LABEL[c.kind]} – {c.title}, {fmtDateTime(c.starts_at)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {user.isAdmin && data && data.unconfirmed.length > 0 && (
        <Card className="mt-4 gap-2 border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 font-semibold"><UserCheck className="size-4 text-primary" /> Čeká na potvrzení účasti ({data.unconfirmed.length})</div>
          <div className="flex flex-wrap gap-2">
            {data.unconfirmed.map((o) => (
              <Button key={o.id} variant="outline" size="sm" render={<Link href={`/lekce/${o.id}#dochazka`} />}>
                {fmtDateShort(o.starts_at)} · {o.title}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section>
          <SectionTitle>Dnešní lekce</SectionTitle>
          {isLoading ? <LoadingList /> : data!.today.length === 0 ? (
            <EmptyState title="Dnes nejsou naplánované žádné lekce" />
          ) : (
            <div className="space-y-2">{data!.today.map((o) => <MiniOcc key={o.id} o={o} />)}</div>
          )}
        </section>
        <section>
          <SectionTitle action={<Link href="/lekce?filtr=neobsazene" className="text-sm text-primary hover:underline">Vše</Link>}>
            Nedostatečně obsazené
          </SectionTitle>
          {isLoading ? <LoadingList /> : data!.understaffed.length === 0 ? (
            <EmptyState title="Všechny lekce jsou obsazené 🎉" />
          ) : (
            <div className="space-y-2">{data!.understaffed.slice(0, 8).map((o) => <MiniOcc key={o.id} o={o} showDate />)}</div>
          )}
        </section>
        <section>
          <SectionTitle action={<Link href="/kalendar" className="text-sm text-primary hover:underline">Kalendář</Link>}>
            Nejbližší akce
          </SectionTitle>
          {isLoading ? <LoadingList /> : (
            <div className="space-y-2">{data!.upcoming.map((o) => <MiniOcc key={o.id} o={o} showDate />)}</div>
          )}
        </section>
      </div>

      <section className="mt-8">
        <SectionTitle>Instruktoři – měsíční statistiky</SectionTitle>
        <TeamTable period={period} onPeriodChange={setPeriod} showExport />
      </section>
    </>
  );
}

function MiniOcc({ o, showDate }: { o: DashboardOccurrence; showDate?: boolean }) {
  const missing = o.required_instructors - o.assigned;
  return (
    <Link href={`/lekce/${o.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:border-primary/40">
      <TypeDot color={o.type_color} className="size-3" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{o.title}</div>
        <div className="text-xs text-muted-foreground">
          {showDate && `${fmtDateShort(o.starts_at)} · `}{fmtTimeRange(o.starts_at, o.ends_at)} · {o.location_name}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <ToneBadge tone={missing > 0 ? "warning" : "success"}>{o.assigned}/{o.required_instructors}</ToneBadge>
        {o.pending > 0 && <span className="text-[11px] text-muted-foreground">{o.pending} čeká</span>}
      </div>
    </Link>
  );
}
