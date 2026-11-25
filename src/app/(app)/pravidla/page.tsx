"use client";

import { CalendarCheck, ClipboardCheck, Handshake, Inbox, MapPin, Users } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TIER } from "@/lib/constants";
import { fmtMoney } from "@/lib/format";
import { useLessonTypes, useLocations, useTeam } from "@/lib/queries";
import type { Tier } from "@/lib/types";

const STEPS = [
  { icon: CalendarCheck, title: "Nahlásíš dostupnost", text: "Do středy vyplníš v aplikaci časové možnosti na následující týden.", href: "/dostupnost", cta: "Vyplnit dostupnost" },
  { icon: Inbox, title: "Dostaneš nabídku", text: "Hlavní instruktoři mají přednost podle dostupnosti a vhodnosti pro daný program. Na volné lekce se můžeš i sám přihlásit.", href: "/lekce?filtr=volne", cta: "Volné lekce" },
  { icon: Handshake, title: "Potvrdíme termíny", text: "Do pátku potvrzujeme známé objednávky na další týden. Další akce se mohou objevit průběžně – dáme ti vědět upozorněním.", href: "/kalendar", cta: "Můj kalendář" },
  { icon: ClipboardCheck, title: "Odučíš a vykážeš práci", text: "Po lekci zapíšeš v aplikaci odučený čas. Správce ho schválí a odměna se ti hned započítá do výkazu.", href: "/", cta: "K vykázání" },
];

export default function RulesPage() {
  const types = useLessonTypes();
  const locations = useLocations();
  const team = useTeam();

  const instructors = (team.data ?? []).filter((p) => p.is_active && p.roles.includes("instructor"));
  const tierCount = (t: Tier) => instructors.filter((p) => p.tier === t).length;
  const rate = (code: string, fallback: number) => Number(types.data?.find((t) => t.code === code)?.hourly_rate ?? fallback);
  const base = rate("skolicka", 400);
  const individual = rate("individual", 500);
  const own = rate("individual_own", 600);
  const activeLocations = (locations.data ?? []).filter((l) => l.is_active).length;
  const programs = (types.data ?? []).filter((t) => t.is_active);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Jak funguje náš tým" description="SUPER KIDS · bruslení · sezóna 2026/2027" />

      <div className="grid grid-cols-2 gap-3">
        <Card className="ice-gradient gap-1 border-0 p-5 text-white">
          <MapPin className="size-5 text-sky-200" />
          <div className="font-[family-name:var(--font-display)] text-4xl font-bold">{activeLocations || "–"}</div>
          <div className="font-semibold">Kluzišť</div>
          <div className="text-sm text-sky-100/80">Prostor pro skupinové i individuální lekce.</div>
        </Card>
        <Card className="gap-1 p-5">
          <Users className="size-5 text-primary" />
          <div className="font-[family-name:var(--font-display)] text-4xl font-bold">{instructors.length || "–"}</div>
          <div className="font-semibold">Instruktorů</div>
          <div className="text-sm text-muted-foreground">Jeden tým s různou mírou zapojení.</div>
        </Card>
      </div>

      <Section n="01" title="Struktura týmu">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["main", "development", "flexible"] as Tier[]).map((t) => (
            <Card key={t} className="gap-1 p-4">
              <div className="font-[family-name:var(--font-display)] text-3xl font-bold text-primary">{tierCount(t)}</div>
              <div className="font-semibold">{TIER[t].label}</div>
              <div className="text-sm text-muted-foreground">{TIER[t].description}</div>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed">
          <b>Cíl:</b> soustředit pravidelnou práci mezi hlavní instruktory a současně mít dost lidí pro větší akce.
          Rozdělení rolí je výchozí a může se měnit podle dostupnosti, spolehlivosti a poptávky.
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          <b>Programy:</b> {programs.map((p) => p.name).join(", ") || "školička bruslení (hlavně v lednu), školy a školky, animační programy, tematické eventy a individuální lekce"}.
        </p>
      </Section>

      <Section n="02" title="Odměny">
        <div className="grid gap-3 sm:grid-cols-3">
          <RateCard amount={base} title="Běžné programy" text="Školička, školy a školky, animace, eventy" />
          <RateCard amount={individual} title="Individuální lekce" text="Klienta zajistí organizátor" />
          <RateCard amount={own} title="Vlastní klient" text="Klienta získáš ty" />
        </div>
        <h3 className="mb-2 mt-6 font-semibold">Modelový měsíční výdělek</h3>
        <Card className="gap-0 overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Běžné hodiny</TableHead><TableHead>Individuálky¹</TableHead><TableHead className="text-right">Odměna</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {[[20, 10], [40, 20], [60, 30], [80, 40]].map(([h, i]) => (
                <TableRow key={h}>
                  <TableCell>{h}</TableCell><TableCell>{i}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(h * base + i * individual)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">¹ Lekce s klientem od organizátora. Jde o příklady, nikoli garantovaný příjem.</p>
        <p className="mt-3 text-sm leading-relaxed">
          Odměna se odvíjí od skutečně odučené práce; počet hodin ani měsíční příjem nejsou garantovány.
          Podmínky DPP, délka individuální lekce a storna se sjednávají předem. Zákonné nároky zaměstnanců zůstávají zachovány.
          Aktuální stav svých hodin a odměny vidíš vždy ve <Link href="/vykazy" className="text-primary hover:underline">Výkazech</Link>.
        </p>
      </Section>

      <Section n="03" title="Od dostupnosti k lekci">
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="flex-row items-start gap-4 p-4">
                <div className="font-[family-name:var(--font-display)] text-3xl font-bold leading-none text-primary">{String(i + 1).padStart(2, "0")}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold"><s.icon className="size-4 text-primary" />{s.title}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.text}</p>
                </div>
                <Button variant="outline" size="sm" className="hidden sm:inline-flex" render={<Link href={s.href} />}>{s.cta}</Button>
              </Card>
            </li>
          ))}
        </ol>
        <Card className="mt-4 gap-1 border-primary/30 bg-primary/5 p-4">
          <div className="font-semibold">Individuální lekce</div>
          <p className="text-sm">
            Společně budujeme klientelu. Organizátor pomáhá s propagací a rezervacemi; ty můžeš získávat i vlastní klienty –
            lekci s vlastním klientem si zapíšeš na <Link href="/" className="text-primary hover:underline">Přehledu</Link> tlačítkem
            „Vlastní klient“. Nepotvrzené termíny si nemusíš blokovat.
          </p>
        </Card>
        <p className="mt-3 text-xs text-muted-foreground">Týdenní termíny plánování jsou navrženým provozním pravidlem. Konkrétní smluvní podmínky mají přednost.</p>
      </Section>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-bold sm:text-2xl"><span className="text-primary">{n} /</span> {title}</h2>
      {children}
    </section>
  );
}

function RateCard({ amount, title, text }: { amount: number; title: string; text: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="font-[family-name:var(--font-display)] text-3xl font-bold text-primary">{fmtMoney(amount)}</div>
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground">{text} · za hodinu</div>
    </Card>
  );
}
