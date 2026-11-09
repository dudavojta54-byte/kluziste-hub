"use client";

import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { EmptyState, LoadingList, PageHeader, TypeDot } from "@/components/common";
import { OccurrenceCard, occurrenceRelation, useMyApplicationMap } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { WEEKDAYS_SHORT } from "@/lib/constants";
import {
  addDays, addMonths, daysBetween, monthGrid, pragueDate, pragueTime, startOfWeek, todayPrague,
} from "@/lib/dates";
import { fmtDate, fmtDayLong, fmtMonth, fmtTimeRange } from "@/lib/format";
import { useLessonTypes, useOccurrences } from "@/lib/queries";
import type { Application, OccurrenceFull } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month" | "list";
type Mode = "mine" | "open" | "all";
const HOUR_START = 7;
const HOUR_END = 22;

export default function CalendarPage() {
  const user = useUser();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [chosenView, setView] = useState<View | null>(null);
  const view: View = chosenView ?? (isMobile ? "list" : "week");
  const [mode, setMode] = useState<Mode>("all");
  const [anchor, setAnchor] = useState(todayPrague());
  const types = useLessonTypes();
  const apps = useMyApplicationMap();

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") return { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) };
    if (view === "month") { const g = monthGrid(anchor); return { from: g[0], to: g[g.length - 1] }; }
    return { from: anchor, to: addDays(anchor, 30) };
  }, [view, anchor]);

  const occ = useOccurrences(range.from, range.to);
  const filtered = useMemo(() => (occ.data ?? []).filter((o) => {
    const rel = occurrenceRelation(o, user.id, apps.get(o.id));
    if (mode === "mine") return rel.isMine || !!rel.activeApp;
    if (mode === "open") return rel.canApply && rel.free > 0;
    return true;
  }), [occ.data, mode, apps, user.id]);

  const byDay = useMemo(() => {
    const m = new Map<string, OccurrenceFull[]>();
    for (const o of filtered) {
      const d = pragueDate(o.starts_at);
      m.set(d, [...(m.get(d) ?? []), o]);
    }
    return m;
  }, [filtered]);

  const step = (dir: 1 | -1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else if (view === "month") setAnchor(addMonths(anchor, dir));
    else setAnchor(addDays(anchor, 30 * dir));
  };

  const title =
    view === "month" ? fmtMonth(anchor)
    : view === "day" ? fmtDayLong(`${anchor}T12:00:00Z`)
    : `${fmtDate(`${range.from}T12:00:00Z`)} – ${fmtDate(`${range.to}T12:00:00Z`)}`;

  return (
    <>
      <PageHeader
        title="Kalendář"
        actions={user.isStaff && <Button render={<Link href="/lekce/nova" />}><CalendarPlus /> Nová lekce</Button>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Předchozí"><ChevronLeft /></Button>
          <Button variant="outline" onClick={() => setAnchor(todayPrague())}>Dnes</Button>
          <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Další"><ChevronRight /></Button>
          <span className="ml-2 font-semibold capitalize">{title}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented value={mode} onChange={setMode} options={[["all", user.isStaff ? "Vše" : "Všechny programy"], ["mine", "Moje lekce"], ["open", "Volné lekce"]]} />
          <Segmented value={view} onChange={setView} options={[["day", "Den"], ["week", "Týden"], ["month", "Měsíc"], ["list", "Seznam"]]} />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {types.data?.map((t) => <span key={t.id} className="flex items-center gap-1.5"><TypeDot color={t.color} />{t.name}</span>)}
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm border-2 border-dashed border-muted-foreground" />přihláška čeká</span>
      </div>

      {occ.isLoading ? <LoadingList rows={4} /> : (
        <>
          {view === "month" && <MonthView anchor={anchor} byDay={byDay} apps={apps} onDay={(d) => { setAnchor(d); setView("day"); }} />}
          {view === "week" && <TimeGrid days={daysBetween(range.from, range.to)} byDay={byDay} apps={apps} />}
          {view === "day" && <TimeGrid days={[anchor]} byDay={byDay} apps={apps} />}
          {view === "list" && (
            filtered.length === 0 ? <EmptyState title="V tomto období nejsou žádné lekce" /> : (
              <div className="space-y-5">
                {[...byDay.entries()].map(([d, list]) => (
                  <section key={d}>
                    <h2 className="mb-2 text-sm font-semibold capitalize text-muted-foreground">{fmtDayLong(`${d}T12:00:00Z`)}</h2>
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {list.map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}
                    </div>
                  </section>
                ))}
              </div>
            )
          )}
        </>
      )}
    </>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-lg bg-muted p-0.5">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium", value === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function useChipStyle() {
  const user = useUser();
  return (o: OccurrenceFull, app?: Application) => {
    const rel = occurrenceRelation(o, user.id, app);
    const pendingMine = !rel.isMine && rel.activeApp && rel.activeApp.status !== "approved";
    return {
      rel,
      className: cn(
        "border-l-4",
        o.status === "cancelled" && "line-through opacity-50",
        pendingMine && "border-dashed",
        user.isStaff && o.status === "scheduled" && rel.free > 0 && "ring-1 ring-warning",
      ),
      style: {
        borderLeftColor: o.lesson_type.color,
        backgroundColor: rel.isMine ? `${o.lesson_type.color}38` : `${o.lesson_type.color}16`,
      },
    };
  };
}

function MonthView({ anchor, byDay, apps, onDay }: {
  anchor: string; byDay: Map<string, OccurrenceFull[]>; apps: Map<string, Application>; onDay: (d: string) => void;
}) {
  const router = useRouter();
  const chip = useChipStyle();
  const today = todayPrague();
  const month = anchor.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS_SHORT.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(anchor).map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} className={cn("min-h-20 border-b border-r p-1 sm:min-h-28 sm:p-1.5", d.slice(0, 7) !== month && "bg-muted/30 text-muted-foreground")}>
              <button onClick={() => onDay(d)}
                className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs font-medium hover:bg-muted", d === today && "bg-primary text-primary-foreground hover:bg-primary")}>
                {Number(d.slice(8))}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((o) => {
                  const s = chip(o, apps.get(o.id));
                  return (
                    <button key={o.id} onClick={() => router.push(`/lekce/${o.id}`)} style={s.style}
                      className={cn("block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight", s.className)}>
                      <span className="hidden font-medium sm:inline">{pragueTime(o.starts_at)} </span>{o.title}
                    </button>
                  );
                })}
                {list.length > 3 && <button onClick={() => onDay(d)} className="text-[11px] text-muted-foreground hover:text-foreground">+{list.length - 3} další</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeGrid({ days, byDay, apps }: { days: string[]; byDay: Map<string, OccurrenceFull[]>; apps: Map<string, Application> }) {
  const chip = useChipStyle();
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const rowH = 48;
  const today = todayPrague();
  const toMin = (iso: string) => { const [h, m] = pragueTime(iso).split(":").map(Number); return h * 60 + m; };

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className={cn("grid", days.length === 1 ? "min-w-0" : "min-w-[760px]")} style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
        <div className="border-b" />
        {days.map((d, i) => (
          <div key={d} className={cn("border-b border-l px-2 py-2 text-center text-xs", d === today && "bg-primary/8")}>
            <div className="text-muted-foreground">{days.length === 1 ? fmtDayLong(`${d}T12:00:00Z`) : WEEKDAYS_SHORT[i]}</div>
            {days.length > 1 && <div className={cn("text-base font-semibold", d === today && "text-primary")}>{Number(d.slice(8))}.</div>}
          </div>
        ))}
        <div className="relative">
          {hours.map((h) => (
            <div key={h} className="pr-2 text-right text-[11px] text-muted-foreground" style={{ height: rowH }}>{h}:00</div>
          ))}
        </div>
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          // jednoduché rozložení souběžných lekcí do sloupců
          const lanes: { end: number }[] = [];
          const placed = list.map((o) => {
            const start = toMin(o.starts_at);
            const end = toMin(o.ends_at);
            let lane = lanes.findIndex((l) => l.end <= start);
            if (lane === -1) { lane = lanes.length; lanes.push({ end }); } else lanes[lane].end = end;
            return { o, start, end, lane };
          });
          return (
            <div key={d} className={cn("relative border-l", d === today && "bg-primary/4")} style={{ height: rowH * hours.length }}>
              {hours.map((h) => <div key={h} className="border-b border-dashed border-border/60" style={{ height: rowH }} />)}
              {placed.map(({ o, start, end, lane }) => {
                const s = chip(o, apps.get(o.id));
                const top = ((Math.max(start, HOUR_START * 60) - HOUR_START * 60) / 60) * rowH;
                const height = Math.max(((end - Math.max(start, HOUR_START * 60)) / 60) * rowH - 2, 22);
                const width = 100 / Math.max(lanes.length, 1);
                return (
                  <Link key={o.id} href={`/lekce/${o.id}`} style={{ ...s.style, top, height, left: `${lane * width}%`, width: `calc(${width}% - 4px)` }}
                    className={cn("absolute mx-0.5 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight shadow-sm hover:z-10 hover:shadow-md", s.className)}>
                    <div className="truncate font-semibold">{o.title}</div>
                    <div className="truncate text-muted-foreground">{fmtTimeRange(o.starts_at, o.ends_at)}</div>
                    {height > 50 && <div className="truncate text-muted-foreground">{o.location.name} · {s.rel.assigned.length}/{o.required_instructors}</div>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Na mobilu je výchozím zobrazením seznam. */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
