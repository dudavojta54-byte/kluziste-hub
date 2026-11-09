# Kluziště Praha | Instructor Hub – architektura

## 1. Přehled

```
 Prohlížeč / PWA (mobil, PC)
 ├─ Next.js 16 App Router (React 19, Tailwind 4, shadcn/ui na Base UI)
 │   ├─ Client komponenty: TanStack Query + supabase-js (anon klíč + session cookie)
 │   │     → čtení přes RLS, mutace přes RPC funkce v Postgresu
 │   ├─ Supabase Realtime → invalidace TanStack Query (sdílená data v reálném čase)
 │   └─ Server Actions / Route Handlers (pouze serverový kód)
 │         → pozvánky, deaktivace účtu, odhlášení ze všech zařízení,
 │           export CSV/PDF, odesílání e-mailů (service role klíč jen zde)
 └─ Supabase
     ├─ Auth (e-mail + heslo, pozvánky, reset hesla, refresh tokeny)
     ├─ PostgreSQL + Row Level Security na všech tabulkách
     ├─ RPC funkce (SECURITY DEFINER) = jediná cesta pro citlivé zápisy
     ├─ Triggery: audit_logs, zámky uzavřených měsíců, e-mailová fronta
     └─ Storage: bucket „documents“ (provozní dokumenty)
 Vercel Cron → /api/cron/emails (odeslání e-mailové fronty přes Resend)
```

**Zásada bezpečnosti:** veškerá pravidla (role, kapacita, konflikty, kredity, uzávěrky)
jsou vynucena v databázi. UI je pouze pohodlná vrstva nad nimi. Klient nikdy nevidí
`SUPABASE_SERVICE_ROLE_KEY`; ten se používá pouze v souborech s `import "server-only"`.

## 2. Role

| Role | Rozvrh a lekce | Přihlášky | Docházka a kredity | Finance ostatních | Účty |
|---|---|---|---|---|---|
| `admin` | vše | schvalování | potvrzování, opravy, bonusy | ano | pozvánky, deaktivace, role |
| `coordinator` | vytváření, úpravy, rušení | schvalování | čtení docházky | **ne** | ne |
| `instructor` | čtení zveřejněných | vlastní | vlastní | vlastní | vlastní profil |

Role jsou v tabulce `user_roles`; funkce `has_role()`, `is_admin()`, `is_staff()` je čtou
v RLS politikách i v RPC funkcích. Deaktivovaný účet (`profiles.is_active = false`) neprojde
žádnou politikou a je navíc zablokován v Supabase Auth (ban).

## 3. Datový model

| Tabulka | Účel |
|---|---|
| `profiles` | veřejný týmový profil (jméno, foto, specializace, sdílený telefon/e-mail, aktivní) |
| `profile_private` | soukromé údaje (osobní telefon, adresa, číslo účtu) – jen vlastník a admin |
| `user_roles` | role uživatelů (admin / coordinator / instructor) |
| `locations` | kluziště (název, adresa, barva) |
| `lesson_types` | typy programů + výchozí kreditový násobek + barva |
| `lessons` | série / šablona lekce (název, typ, lokalita, popis, pokyny, kapacita, násobek, opakování) |
| `lesson_occurrences` | konkrétní termín (start/konec v `timestamptz`, kapacita, stav, uzávěrka přihlášek) |
| `lesson_applications` | přihlášky (pending → approved / rejected / waitlisted / withdrawn / cancel_requested) |
| `instructor_assignments` | potvrzené obsazení; `during tstzrange` + **EXCLUDE constraint** zabraňuje dvojímu obsazení |
| `availability` | dostupnost – konkrétní den nebo pravidelný den v týdnu |
| `attendance_records` | skutečná účast (skutečné hodiny, stav, potvrzení adminem) – 1 záznam na obsazení |
| `credit_ledger` | append-only kniha kreditů (lekce, bonus, korekce) – opravy = protizápis |
| `bonus_records` | bonusy: kreditové i finanční, důvod, datum, kdo schválil |
| `reward_settings` | model odměny (credit / hourly / fixed), sazby, měsíční cíl, platnost od |
| `report_periods` | stav měsíce (open / closed) + snímek výkazu při uzavření |
| `notifications` | in-app notifikace jednotlivých uživatelů |
| `announcements`, `announcement_recipients` | oznámení týmu / vybraným, potvrzení přečtení |
| `contacts` | provozní kontakty (manažer, koordinátor, vedoucí kluziště, podpora, krize) |
| `documents` | provozní dokumenty a informace |
| `email_outbox` | fronta e-mailů (vzniká triggerem z notifikací) |
| `app_settings` | parametry (lhůta pro odhlášení, časové pásmo, …) |
| `audit_logs` | auditní stopa všech změn citlivých tabulek (kdo, kdy, staré/nové hodnoty) |

### Klíčová pravidla v DB

* **Atomické obsazování:** `apply_to_occurrence` a `approve_application` zamykají řádek termínu
  (`SELECT … FOR UPDATE`), takže poslední volné místo nemůže být přiděleno dvakrát.
* **Duplicitní přihláška:** unikátní index `(occurrence_id, user_id)`.
* **Časový konflikt:** `EXCLUDE USING gist (user_id WITH =, during WITH &&)` nad aktivními obsazeními
  + kontrola již při podání přihlášky.
* **Kredity** vznikají pouze funkcí `confirm_attendance` (admin): `hodiny × násobek`, jeden zápis na
  obsazení (unikátní `source`). Oprava vytvoří korekční zápis s rozdílem – historie zůstává.
* **Hodiny, kredity a peníze** jsou oddělené sloupce/tabulky a nikdy se automaticky nezaměňují.
* **Uzavřený měsíc:** trigger zakáže změny docházky, kreditů a bonusů v uzavřeném měsíci; znovuotevření
  smí jen admin a je auditováno.
* **Čas:** vše se ukládá jako `timestamptz` (UTC), zobrazuje a zadává se v `Europe/Prague`
  (správně přes změnu letního/zimního času).

## 4. Výpočet odměny (`monthly_statement`)

* hodiny = Σ skutečných hodin potvrzené docházky v měsíci
* kredity za lekce = Σ ledger (lesson + korekce); bonusové kredity = Σ ledger (bonus)
* **A – credit:** (kredity za lekce + bonusové kredity) × cena kreditu
* **B – hourly:** hodiny × hodinová sazba
* **C – fixed:** fixní částka; kredity jen jako výkonnostní ukazatel vůči cíli
* ke všem modelům se přičtou finanční bonusy

## 5. Implementační etapy

1. Základ – projekt, migrace, Auth, role, navigace, dashboardy
2. Lekce a kalendář – lekce, série, kalendář, přihlášky, schvalování, dostupnost
3. Kredity a odměny – docházka, kredity, bonusy, sazby, výkazy, export CSV/PDF
4. Tým a komunikace – kontakty, oznámení, potvrzení přečtení, e-maily
5. Produkce – responzivita, PWA, testy (PGlite = skutečný Postgres v testech), nasazení
