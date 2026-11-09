"use client";

import { Award, CalendarClock, Clock, Sparkles, Target, Ticket, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, LoadingList, PageHeader, SectionTitle, StatCard, TypeDot } from "@/components/common";
import { OccurrenceCard, occurrenceRelation, useMyApplicationMap } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { REWARD_MODEL } from "@/lib/constants";
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
    const open = list.filter((o) => occurrenceRelation(o, user.id, apps.get(o.id)).canApply && o.assignments.filter((a) => a.status === "active").length < o.required_instructors);
    return { mine, open };
  }, [upcoming.data, apps, user.id]);

  const s = statement.data;
  const target = s?.monthly_credit_target ?? null;
  const next = mine.find((o) => o.assignments.some((a) => a.user_id === user.id && a.status === "active"));

  const chartData = (history.data ?? []).map((h) => ({
    month: fmtMonth(h.period).split(" ")[0].slice(0, 3),
    Lekce: Number(h.lesson_credits),
    Bonusy: Number(h.bonus_credits),
  }));

  return (
    <>
      <PageHeader
        title={`Ahoj, ${user.profile.first_name || "instruktore"} 👋`}
        description={fmtDayLong(new Date())}
        actions={user.isStaff && <Button variant="outline" render={<Link href="/" />}>Provozní přehled</Button>}
      />

      {next && (
        <Link href={`/lekce/${next.id}`} className="ice-gradient mb-6 block rounded-2xl p-5 text-white shadow-lg shadow-sky-900/10 sm:p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-sky-200">
            <CalendarClock className="size-4" /> Nejbližší lekce
          </div>
          <div className="mt-2 font-[family-name:var(--font-display)] text-xl font-bold sm:text-2xl">{next.title}</div>
          <div className="mt-1 text-sm text-sky-100/90">
            {fmtDayLong(next.starts_at)} · {new Date(next.starts_at).toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" })} · {next.location.name}
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard accent label="Kredity tento měsíc" icon={Sparkles} value={fmtNum(s?.total_credits ?? 0)}
          hint={`${fmtNum(s?.lesson_credits ?? 0)} za lekce · ${fmtNum(s?.bonus_credits ?? 0)} bonus`} />
        <StatCard label="Odpracováno" icon={Clock} value={fmtHours(s?.hours)} hint={`${s?.lessons ?? 0} dokončených lekcí`} />
        <StatCard label="Bonusové kredity" icon={Award} value={fmtNum(s?.bonus_credits ?? 0)}
          hint={s && s.bonus_amount > 0 ? `+ ${fmtMoney(s.bonus_amount)} finanční bonus` : "za mimořádnou práci"} />
        <StatCard label="Odhad odměny" icon={Wallet} value={fmtMoney(s?.total_amount)}
          hint={s?.model ? REWARD_MODEL[s.model].label : "Model odměny zatím nenastaven"} />
      </div>

      {target != null && target > 0 && (
        <Card className="mt-3 gap-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium"><Target className="size-4 text-primary" /> Měsíční cíl</span>
            <span className="tabular-nums text-muted-foreground">{fmtNum(s?.total_credits)} / {fmtNum(target)} kreditů</span>
          </div>
          <Progress value={Math.min(((s?.total_credits ?? 0) / target) * 100, 100)} />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <section>
            <SectionTitle action={<Link href="/kalendar" className="text-sm text-primary hover:underline">Kalendář</Link>}>
              Moje nejbližší lekce
            </SectionTitle>
            {upcoming.isLoading ? <LoadingList /> : mine.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Zatím nemáte žádné naplánované lekce">Přihlaste se na některou z volných lekcí níže.</EmptyState>
            ) : (
              <div className="space-y-2.5">{mine.slice(0, 5).map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}</div>
            )}
          </section>

          <section>
            <SectionTitle action={<Link href="/lekce?filtr=volne" className="text-sm text-primary hover:underline">Všechny volné</Link>}>
              Volné lekce
            </SectionTitle>
            {upcoming.isLoading ? <LoadingList /> : open.length === 0 ? (
              <EmptyState icon={Ticket} title="Momentálně nejsou volné lekce">O nových lekcích vás upozorníme.</EmptyState>
            ) : (
              <div className="space-y-2.5">{open.slice(0, 6).map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}</div>
            )}
          </section>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle>Vývoj kreditů</SectionTitle>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -20, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="Lekce" stackId="a" fill="var(--chart-1)" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="Bonusy" stackId="a" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="gap-3 p-4 sm:p-5">
            <SectionTitle action={<Link href="/vykazy" className="text-sm text-primary hover:underline">Výkaz</Link>}>
              Rozpis za {fmtMonth(period).toLowerCase()}
            </SectionTitle>
            {!s || s.by_type.length === 0 ? (
              <p className="text-sm text-muted-foreground">Kredity se připíší po potvrzení účasti správcem.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.by_type.map((t) => (
                  <li key={t.lesson_type_id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><TypeDot color={t.color} />{t.name}</span>
                    <span className="tabular-nums text-muted-foreground">{fmtHours(t.hours)} · <b className="text-foreground">{fmtNum(t.credits)} kr</b></span>
                  </li>
                ))}
                {s.bonuses.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><Award className="size-3 text-primary" />{b.reason_text}</span>
                    <span className="tabular-nums"><b>{b.credits > 0 ? `${fmtNum(b.credits)} kr` : ""}</b>{b.amount > 0 ? ` ${fmtMoney(b.amount)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
