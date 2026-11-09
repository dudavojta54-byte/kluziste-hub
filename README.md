# Kluziště Praha | Instructor Hub

Plně funkční aplikace pro koordinaci instruktorů bruslení: směny a lekce, přihlašování
a schvalování, kalendář, dostupnost, docházka, výkonové kredity, odměny, měsíční výkazy
(CSV/PDF), týmové kontakty a oznámení. Mobil i počítač, světlý i tmavý režim, instalace jako PWA.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind 4 · shadcn/ui (Base UI) · Supabase
(PostgreSQL, Auth, RLS, Realtime, Storage) · TanStack Query · React Hook Form + Zod · Recharts ·
pdf-lib · Vitest + PGlite · Vercel

- Architektura a datový model: [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md)
- Návod pro uživatele: [docs/NAVOD.md](docs/NAVOD.md)

---

## Rychlý start (lokálně proti Supabase projektu)

```bash
npm install
cp .env.example .env.local      # doplňte klíče ze Supabase
npm run dev
```

### 1. Supabase projekt

1. Vytvořte projekt na [supabase.com](https://supabase.com) (region **Frankfurt / eu-central-1**).
2. Spusťte migrace – buď přes Supabase CLI:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   nebo vložte postupně soubory ze `supabase/migrations/` do **SQL Editoru** (v pořadí čísel).
3. **Authentication → Sign In / Providers → Email:** vypněte *Allow new users to sign up*
   (účty zakládá jen správce pozvánkou). Doporučeno: minimální délka hesla 10.
4. **Authentication → URL Configuration:** *Site URL* = adresa aplikace (např. `https://hub.kluziste.cz`),
   do *Redirect URLs* přidejte `https://hub.kluziste.cz/auth/confirm` (a `http://localhost:3000/auth/confirm`).
5. **Authentication → Email Templates:** šablony *Invite user* a *Reset password* nahraďte obsahem
   `supabase/templates/invite.html` a `recovery.html` (odkazují na `/auth/confirm?token_hash=…`).
6. Pro produkci nastavte vlastní SMTP (*Project Settings → Auth → SMTP*), vestavěný Supabase SMTP
   má nízký limit e-mailů.

### 2. První správce

```bash
npm run create-admin -- spravce@kluziste.cz Jana Horáková
```
Přijde pozvánka; po nastavení hesla se správce přihlásí a další členy zve v **Správa → Uživatelé**.

### 3. Demo data (volitelné, jen testovací projekt)

```bash
DEMO_PASSWORD='zvolte-heslo-123' npm run seed:demo
```
Vytvoří 10 demo účtů (`…@example.com`), 3 kluziště, rozvrh od ~5 týdnů zpět do ~10 týdnů dopředu
(školičky, školy, animace, individuální lekce, Mikulášská show, Silvestr, Valentýn), přihlášky,
schválení, potvrzenou docházku, bonusy, dostupnost, oznámení a uzavřený předchozí měsíc.
Všechno prochází stejnými RPC funkcemi jako aplikace.

## Nasazení na Vercel

1. Importujte repozitář do Vercelu (framework se rozpozná automaticky).
2. **Environment Variables:**

| Proměnná | Kde | Poznámka |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | vše | URL projektu |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | vše | publishable klíč `sb_publishable_…` (data chrání RLS); starší `NEXT_PUBLIC_SUPABASE_ANON_KEY` funguje také |
| `SUPABASE_SERVICE_ROLE_KEY` | **jen server** | pozvánky, deaktivace, e-mailová fronta – nikdy s prefixem `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | vše | veřejná adresa (odkazy v e-mailech) |
| `RESEND_API_KEY`, `EMAIL_FROM` | server | e-mailová upozornění (ověřená doména v Resend) |
| `CRON_SECRET` | server | náhodný řetězec; Vercel Cron ho posílá v hlavičce |

3. `vercel.json` spouští odesílání e-mailové fronty každých 10 minut. Na plánu **Hobby** Vercel
   povoluje jen denní cron – použijte Pro, nebo volejte `/api/cron/emails` (s hlavičkou
   `Authorization: Bearer $CRON_SECRET`) z externího plánovače / Supabase `pg_cron` + `pg_net`.

## Testy

```bash
npm test          # 49 testů
npm run typecheck
npm run lint
```

- `tests/db/workflows.test.ts` – **skutečný PostgreSQL (PGlite)** se všemi migracemi, RLS a RPC:
  pozvání/účty, vytvoření lekce (včetně letního/zimního času), přihlášky, náhradníci, souběžné
  obsazování posledního místa, časové konflikty (i přímým zápisem do DB), výpočet a oprava kreditů,
  bonusy, modely odměn A/B/C, uzavření měsíce a jeho zámky, ochrana dat mezi instruktory,
  koordinátorem a nepřihlášeným uživatelem, oznámení s potvrzením, návrhy instruktorů.
- `tests/unit/*` – pozvánky a deaktivace (server actions), kalendářní výpočty, CSV a PDF export.

## Bezpečnost

- RLS zapnuté na všech tabulkách; anon role nemá přístup k ničemu.
- Citlivé zápisy (přihlášky, schvalování, docházka, kredity, bonusy, uzávěrky) jen přes
  `SECURITY DEFINER` funkce s kontrolou role; interní funkce nejsou volatelné z klienta.
- Kniha kreditů je append-only, opravy = korekční zápisy; audit všech citlivých tabulek.
- Uzavřený měsíc je zamčen triggerem; znovuotevření jen správce s důvodem (auditováno).
- Atomické obsazování (`SELECT … FOR UPDATE`), duplicitní přihláška (unikátní index),
  dvojí obsazení (`EXCLUDE USING gist`).
- Service role klíč jen v `server-only` modulech; serverové akce ověřují roli znovu.
- Deaktivace účtu = okamžitý konec přístupu přes RLS + ban v Supabase Auth (nelze obnovit token).
- Bezpečnostní hlavičky (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy).
- CSV export chráněn proti formula injection.

## Zálohování a obnova

- Supabase Pro dělá denní zálohy; pro důležitá data zapněte **Point-in-Time Recovery**.
- Ruční záloha: `npx supabase db dump --data-only > zaloha.sql` (CLI, propojený projekt).
- Uzavřené měsíce mají v `report_periods.snapshot` neměnný snímek výkazů a `audit_logs` obsahují
  předchozí hodnoty všech změn – obojí umožňuje dohledat a obnovit jednotlivé záznamy.

## Struktura

```
supabase/migrations/   schéma, RLS, RPC funkce, triggery (zdroj pravdy pro pravidla)
supabase/templates/    české e-mailové šablony Auth
src/app/(auth)/        přihlášení, obnova hesla
src/app/(app)/         chráněná aplikace (dashboard, kalendář, lekce, výkazy, tým, …)
src/app/api/           export CSV/PDF, cron pro e-maily
src/components/        UI (shell, dashboardy, lekce, výkazy)
src/lib/               Supabase klienti, dotazy (TanStack), datumy, export, validace
scripts/               create-admin, seed-demo
tests/                 PGlite DB testy + unit testy
```

## Poznámky k zadání

- Tabulka násobků v zadání uvádí individuální lekci **2,5**, příklad pak počítá s **1,5**
  (2 h → 3 kredity). Aplikace používá 2,5 z tabulky; hodnotu lze změnit v **Správa → Programy a
  kredity** nebo u konkrétní lekce.
- Push notifikace: service worker už umí zobrazit push zprávu; pro zapnutí je potřeba vygenerovat
  VAPID klíče a přidat odběr – základem jsou spolehlivé in-app + e-mailové notifikace.
