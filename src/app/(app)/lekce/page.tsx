"use client";

import { CalendarPlus, ListChecks, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { EmptyState, LoadingList, NativeSelect, PageHeader } from "@/components/common";
import { OccurrenceCard, occurrenceRelation, useMyApplicationMap } from "@/components/lessons/occurrence-card";
import { useUser } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pragueDate } from "@/lib/dates";
import { fmtDayLong } from "@/lib/format";
import { useLessonTypes, useLocations, useUpcomingOccurrences } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Filter = "volne" | "moje" | "vse" | "neobsazene";

export default function LessonsPage() {
  return (
    <Suspense fallback={<LoadingList />}>
      <Lessons />
    </Suspense>
  );
}

function Lessons() {
  const user = useUser();
  const params = useSearchParams();
  const router = useRouter();
  const filter = (params.get("filtr") as Filter) ?? (user.isStaff ? "vse" : "volne");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loc, setLoc] = useState("");
  const occ = useUpcomingOccurrences(400);
  const apps = useMyApplicationMap();
  const types = useLessonTypes();
  const locations = useLocations();

  const tabs: { key: Filter; label: string }[] = [
    { key: "volne", label: "Volné" },
    { key: "moje", label: "Moje" },
    { key: "vse", label: "Všechny" },
    ...(user.isStaff ? [{ key: "neobsazene" as Filter, label: "Neobsazené" }] : []),
  ];

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (occ.data ?? []).filter((o) => {
      const rel = occurrenceRelation(o, user.id, apps.get(o.id));
      if (filter === "volne" && !(rel.canApply && rel.free > 0)) return false;
      if (filter === "moje" && !(rel.isMine || rel.activeApp)) return false;
      if (filter === "neobsazene" && rel.free === 0) return false;
      if (type && o.lesson_type_id !== type) return false;
      if (loc && o.location_id !== loc) return false;
      if (needle && !`${o.title} ${o.location.name} ${o.lesson_type.name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const map = new Map<string, typeof list>();
    for (const o of list) {
      const d = pragueDate(o.starts_at);
      map.set(d, [...(map.get(d) ?? []), o]);
    }
    return [...map.entries()];
  }, [occ.data, apps, filter, q, type, loc, user.id]);

  return (
    <>
      <PageHeader
        title="Lekce a směny"
        description="Nadcházející programy na kluzištích"
        actions={user.isStaff && <Button render={<Link href="/lekce/nova" />}><CalendarPlus /> Nová lekce</Button>}
      />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => router.replace(`/lekce?filtr=${t.key}`)}
              className={cn("flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                filter === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input placeholder="Hledat…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Všechny programy</option>
            {types.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
          <NativeSelect value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">Všechny lokality</option>
            {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
        </div>
      </div>

      {occ.isLoading ? <LoadingList rows={5} /> : grouped.length === 0 ? (
        <EmptyState icon={ListChecks} title="Žádné lekce neodpovídají filtru" />
      ) : (
        <div className="space-y-6">
          {grouped.map(([d, list]) => (
            <section key={d}>
              <h2 className="sticky top-14 z-10 -mx-1 mb-2 bg-background/90 px-1 py-1 text-sm font-semibold capitalize text-muted-foreground backdrop-blur">
                {fmtDayLong(`${d}T12:00:00Z`)}
              </h2>
              <div className="grid gap-2.5 md:grid-cols-2">
                {list.map((o) => <OccurrenceCard key={o.id} occ={o} app={apps.get(o.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
