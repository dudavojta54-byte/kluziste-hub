"use client";

import { Award, CalendarClock, CheckCircle2, Clock, Compass, Ticket, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, LoadingList, PageHeader, SectionTitle, StatCard, ToneBadge, TypeDot } from "@/components/common";
import { MilestoneProgress } from "@/components/instructor/milestones";
import { AvailabilityReminder, LessonsToReport, OwnClientDialog } from "@/components/instructor/work";
import { OccurrenceCard, occurrenceRelation, useMyApplicationMap } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TIER } from "@/lib/constants";
import { startOfMonth, todayPrague } from "@/lib/dates";
import { fmtDayLong, fmtHours, fmtMoney, fmtMonth, fmtNum } from "@/lib/format";
import { useCreditHistory, useStatement, useUpcomingOccurrences } from "@/lib/queries";

export function InstructorDashboard() {
  const user = useUser();
  const period = startOfMonth(todayPrague());
  const statement = useStatement(user.id, period);
  const history = useCreditHistory(6);
  const upcoming = useUpcomingOccurrences(80);
  const apps = useMyApplicationMap();

  const { mine, open } = useMemo(() => {
    const list = upcoming.data ?? [];
    const mine = list.filter((o) => {
      const rel = occurrenceRelation(o, user.id, apps.get(o.id));
      return rel.isMine || rel.activeApp;
    });
    const open = list.filter((o) => {
      const rel = occurrenceRelation(o, user.id, apps.get(o.id));
      return rel.canApply && rel.free > 0;
    });
    return { mine, open };
  }, [upcoming.data, apps, user.id]);

  const s = statement.data;
  const next = mine.find((o) => o.assignments.some((a) => a.user_id === user.id && a.status === "active"));
  const chartData = (history.data ?? []).map((h) => ({
    month: fmtMonth(h.period).split(" ")[0].slice(0, 3),
    Odměna: Math.round(Number(h.amount)),
    Hodiny: Number(h.hours),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Ahoj, ${user.profile.first_name || "instruktore"} 👋`}
        description={<>{fmtDayLong(new Date())} · <ToneBadge tone={TIER[user.profile.tier ?? "flexible"].tone}>{TIER[user.profile.tier ?? "flexible"].label} instruktor</ToneBadge></>}
        actions={
          <>
            <OwnClientDialog />
            {user.isStaff && <Button variant="outline" render={<Link href="/" />}>Provozní přehled</Button>}
          </>
        }
      />

      <AvailabilityReminder />
      <LessonsToReport />

      {next && (
        <Link href={`/lekce/${next.id}`} className="ice-gradient block rounded-2xl p-5 text-white shadow-lg shadow-sky-900/10 sm:p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-sky-200">
            <CalendarClock className="size-4" /> Nejbližší lekce
          </div>
          <div className="mt-2 font-[family-name:var(--font-display)] text-xl font-bold sm:text-2xl">{next.title}</div>
          <div className="mt-1 text-sm capitalize text-sky-100/90">
            {fmtDayLong(next.starts_at)} · {new Date(next.starts_at).toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" })} · {next.location.name}
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent label="Odměna tento měsíc" icon={Wallet} value={fmtMoney(s?.total_amount ?? 0)}
          hint={s?.closed ? "uzavřený výkaz" : "ze schválených hodin"} />
        <StatCard label="Odučeno" icon={Clock} value={fmtHours(s?.hours)} hint="schválené hodiny" />
        <StatCard label="Dokončené lekce" icon={CheckCircle2} value={s?.lessons ?? 0} />
        <StatCard label="Bonusy" icon={Award} value={fmtMoney(s?.bonus_amount ?? 0)} hint="za mimořádnou práci" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <section>
            <SectionTitle action={<Link href="/kalendar" className="text-sm text-primary hover:underline">Kalendář</Link>}>
              Moje nejbližší lekce
            </SectionTitle>
            {upcoming.isLoading ? <LoadingList /> : mine.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Zatím nemáš žádné naplánované lekce">Přihlas se na volnou lekci níže.</EmptyState>
            ) : (
              <div className="space-y-2.5">{mine.slice(0, 5).map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}</div>
            )}
          </section>

          <section>
            <SectionTitle action={<Link href="/lekce?filtr=volne" className="text-sm text-primary hover:underline">Všechny volné</Link>}>
              Volné lekce
            </SectionTitle>
            {upcoming.isLoading ? <LoadingList /> : open.length === 0 ? (
              <EmptyState icon={Ticket} title="Momentálně nejsou volné lekce">O nových lekcích tě upozorníme.</EmptyState>
            ) : (
              <div className="space-y-2.5">{open.slice(0, 6).map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}</div>
            )}
          </section>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <MilestoneProgress />

          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle action={<Link href="/vykazy" className="text-sm text-primary hover:underline">Výkaz</Link>}>
              {fmtMonth(period)}
            </SectionTitle>
            {!s || s.by_type.length === 0 ? (
              <p className="text-sm text-muted-foreground">Odměna se započítá, jakmile správce schválí tvůj vykázaný čas.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.by_type.map((t) => (
                  <li key={t.lesson_type_id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2"><TypeDot color={t.color} /><span className="truncate">{t.name}</span></span>
                    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {fmtNum(t.hours)} h × {fmtMoney(t.hourly_rate)} = <b className="text-foreground">{fmtMoney(t.amount)}</b>
                    </span>
                  </li>
                ))}
                {s.bonuses.filter((b) => b.amount > 0).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><Award className="size-3 text-primary" />{b.reason_text}</span>
                    <b className="tabular-nums">{fmtMoney(b.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle>Odměna po měsících</SectionTitle>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -6, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    formatter={(v, name) => (name === "Odměna" ? fmtMoney(Number(v)) : `${v} h`)}
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="Odměna" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Link href="/pravidla" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary/40">
            <Compass className="size-5 text-primary" />
            <div className="text-sm"><b>Jak funguje náš tým</b><div className="text-muted-foreground">Odměny, týdenní rytmus, individuální lekce</div></div>
          </Link>
        </div>
      </div>
    </div>
  );
}
