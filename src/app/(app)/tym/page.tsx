"use client";

import { Mail, MapPin, Phone, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { LoadingList, PageHeader, SectionTitle, ToneBadge, UserAvatar } from "@/components/common";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CONTACT_CATEGORY, ROLE_LABELS } from "@/lib/constants";
import { fullName } from "@/lib/format";
import { useContacts, useLessonTypes, useLocations, useTeam } from "@/lib/queries";
import type { AppRole } from "@/lib/types";

export default function TeamPage() {
  const team = useTeam();
  const contacts = useContacts();
  const types = useLessonTypes();
  const locations = useLocations();
  const [q, setQ] = useState("");

  const typeName = (code: string) => types.data?.find((t) => t.code === code)?.name ?? code;
  const locName = (id: string | null) => locations.data?.find((l) => l.id === id)?.name;
  const members = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (team.data ?? []).filter((p) => p.is_active && (!n || fullName(p).toLowerCase().includes(n)));
  }, [team.data, q]);

  const active = (contacts.data ?? []).filter((c) => c.is_active);

  return (
    <>
      <PageHeader title="Tým a kontakty" description="Kontakty sdílené v rámci týmu. Soukromé a účetní údaje zde nejsou zobrazeny." />

      <section className="mb-8">
        <SectionTitle>Provozní kontakty</SectionTitle>
        {contacts.isLoading ? <LoadingList rows={2} /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((c) => (
              <Card key={c.id} className={`gap-1.5 p-4 ${c.category === "emergency" ? "border-destructive/40 bg-destructive/5" : ""}`}>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {c.category === "emergency" && <ShieldAlert className="size-4 text-destructive" />}
                  {CONTACT_CATEGORY[c.category]}
                </div>
                <div className="font-semibold">{c.name}</div>
                {c.role_label && <div className="text-sm text-muted-foreground">{c.role_label}</div>}
                <div className="mt-1 flex flex-col gap-1 text-sm">
                  {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="flex items-center gap-2 font-medium text-primary"><Phone className="size-4" />{c.phone}</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-2 text-primary"><Mail className="size-4" />{c.email}</a>}
                </div>
                {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle action={
          <div className="relative w-44 sm:w-56">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input placeholder="Hledat člena…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
        }>Členové týmu ({members.length})</SectionTitle>
        {team.isLoading ? <LoadingList /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((p) => (
              <Card key={p.id} id={p.id} className="flex-row gap-3 p-4">
                <UserAvatar profile={p} className="size-12" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-semibold">{fullName(p)}</div>
                  <div className="text-xs text-muted-foreground">{p.title ?? (p.roles as AppRole[]).map((r) => ROLE_LABELS[r]).join(", ")}</div>
                  {p.specializations.length > 0 && (
                    <div className="flex flex-wrap gap-1">{p.specializations.map((s) => <ToneBadge key={s} tone="info">{typeName(s)}</ToneBadge>)}</div>
                  )}
                  {locName(p.preferred_location_id) && <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="size-3" />{locName(p.preferred_location_id)}</div>}
                  <div className="flex flex-col gap-0.5 pt-1 text-sm">
                    {p.team_phone && <a href={`tel:${p.team_phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 text-primary"><Phone className="size-3.5" />{p.team_phone}</a>}
                    {p.team_email && <a href={`mailto:${p.team_email}`} className="flex items-center gap-1.5 truncate text-primary"><Mail className="size-3.5" />{p.team_email}</a>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
