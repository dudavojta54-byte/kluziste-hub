-- =====================================================================
-- Kluziště Praha | Instructor Hub – schéma databáze
-- Všechny časy jsou timestamptz (UTC), zobrazení v Europe/Prague.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Výčtové typy
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'coordinator', 'instructor');
create type public.registration_status as enum ('open', 'closed');
create type public.occurrence_status as enum ('scheduled', 'cancelled', 'completed');
create type public.application_status as enum
  ('pending', 'approved', 'rejected', 'waitlisted', 'withdrawn', 'cancel_requested');
create type public.assignment_status as enum ('active', 'cancelled');
create type public.availability_kind as enum ('available', 'unavailable', 'preferred');
create type public.attendance_status as enum ('present', 'partial', 'absent');
create type public.ledger_kind as enum ('lesson', 'bonus', 'adjustment');
create type public.reward_model as enum ('credit', 'hourly', 'fixed');
create type public.bonus_reason as enum
  ('quality', 'last_minute', 'new_program', 'training', 'initiative', 'other');
create type public.contact_category as enum
  ('program_manager', 'coordinator', 'rink_manager', 'tech_support', 'emergency', 'other');
create type public.period_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------
-- Uživatelé
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  title text,                                  -- např. „Hlavní instruktor“
  avatar_url text,
  team_phone text,                             -- telefon sdílený s týmem
  team_email text,                             -- e-mail sdílený s týmem
  specializations text[] not null default '{}',-- kódy lesson_types
  preferred_location_id uuid,
  bio text,
  notify_email boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  personal_phone text,
  address text,
  bank_account text,
  birth_date date,
  emergency_contact text,
  admin_note text,
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------
-- Číselníky
-- ---------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  color text not null default '#0ea5e9',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_preferred_location_fk
  foreign key (preferred_location_id) references public.locations (id) on delete set null;

create table public.lesson_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  credit_multiplier numeric(6, 2),             -- null = nastavitelné u každé lekce
  color text not null default '#0ea5e9',
  sort_order int not null default 0,
  is_active boolean not null default true,
  check (credit_multiplier is null or credit_multiplier >= 0)
);

-- ---------------------------------------------------------------------
-- Lekce (série) a jejich termíny
-- ---------------------------------------------------------------------
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 160),
  lesson_type_id uuid not null references public.lesson_types (id),
  location_id uuid not null references public.locations (id),
  description text,
  instructions text,
  required_instructors int not null default 1 check (required_instructors between 1 and 50),
  credit_multiplier numeric(6, 2) not null check (credit_multiplier >= 0),
  start_time time not null,
  end_time time not null,
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly', 'custom')),
  registration_deadline_hours int not null default 24 check (registration_deadline_hours between 0 and 720),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lesson_occurrences (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  title text not null,
  lesson_type_id uuid not null references public.lesson_types (id),
  location_id uuid not null references public.locations (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  required_instructors int not null check (required_instructors between 1 and 50),
  credit_multiplier numeric(6, 2) not null check (credit_multiplier >= 0),
  description text,
  instructions text,
  registration_status public.registration_status not null default 'open',
  registration_deadline timestamptz,
  status public.occurrence_status not null default 'scheduled',
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '16 hours')
);
create index lesson_occurrences_starts_idx on public.lesson_occurrences (starts_at);
create index lesson_occurrences_lesson_idx on public.lesson_occurrences (lesson_id, starts_at);

create table public.lesson_applications (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.lesson_occurrences (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.application_status not null default 'pending',
  note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, user_id)                -- ochrana proti duplicitní přihlášce
);
create index lesson_applications_user_idx on public.lesson_applications (user_id);
create index lesson_applications_status_idx on public.lesson_applications (status);

create table public.instructor_assignments (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.lesson_occurrences (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.lesson_applications (id) on delete set null,
  status public.assignment_status not null default 'active',
  during tstzrange not null,
  assigned_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  -- jeden instruktor nesmí mít dvě aktivní lekce, které se časově překrývají
  constraint instructor_assignments_no_overlap
    exclude using gist (user_id with =, during with &&) where (status = 'active')
);
create unique index instructor_assignments_active_uniq
  on public.instructor_assignments (occurrence_id, user_id) where status = 'active';
create index instructor_assignments_user_idx on public.instructor_assignments (user_id);

-- ---------------------------------------------------------------------
-- Dostupnost
-- ---------------------------------------------------------------------
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date,
  weekday smallint check (weekday between 1 and 7),   -- ISO: 1 = pondělí
  start_time time,
  end_time time,
  kind public.availability_kind not null,
  note text,
  created_at timestamptz not null default now(),
  check ((date is null) <> (weekday is null)),
  check (start_time is null or end_time is null or end_time > start_time)
);
create index availability_user_idx on public.availability (user_id, date);

-- ---------------------------------------------------------------------
-- Docházka, kredity, bonusy, odměny
-- ---------------------------------------------------------------------
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.instructor_assignments (id),
  occurrence_id uuid not null references public.lesson_occurrences (id),
  user_id uuid not null references public.profiles (id),
  lesson_type_id uuid not null references public.lesson_types (id),
  period date not null,                           -- 1. den měsíce (Praha)
  status public.attendance_status not null,
  hours numeric(6, 2) not null check (hours >= 0 and hours <= 16),
  credit_multiplier numeric(6, 2) not null,
  credits numeric(10, 2) not null,
  note text,
  confirmed_by uuid not null references public.profiles (id),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index attendance_user_period_idx on public.attendance_records (user_id, period);

create table public.bonus_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  reason public.bonus_reason not null,
  reason_text text not null check (length(reason_text) between 2 and 500),
  awarded_on date not null,
  period date not null,
  credits numeric(10, 2) not null default 0 check (credits >= 0),
  amount numeric(12, 2) not null default 0 check (amount >= 0),   -- Kč
  approved_by uuid not null references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  created_at timestamptz not null default now(),
  check (credits > 0 or amount > 0)
);
create index bonus_records_user_period_idx on public.bonus_records (user_id, period);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  period date not null,
  kind public.ledger_kind not null,
  credits numeric(10, 2) not null,
  lesson_type_id uuid references public.lesson_types (id),
  attendance_id uuid references public.attendance_records (id),
  bonus_id uuid references public.bonus_records (id),
  description text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((attendance_id is not null) or (bonus_id is not null) or kind = 'adjustment')
);
create index credit_ledger_user_period_idx on public.credit_ledger (user_id, period);
create index credit_ledger_attendance_idx on public.credit_ledger (attendance_id);

create table public.reward_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  model public.reward_model not null,
  credit_rate numeric(10, 2) not null default 0 check (credit_rate >= 0),
  hourly_rate numeric(10, 2) not null default 0 check (hourly_rate >= 0),
  fixed_amount numeric(12, 2) not null default 0 check (fixed_amount >= 0),
  monthly_credit_target numeric(10, 2) check (monthly_credit_target is null or monthly_credit_target >= 0),
  valid_from date not null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (user_id, valid_from)
);

create table public.report_periods (
  period date primary key check (extract(day from period) = 1),
  status public.period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  snapshot jsonb,
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id),
  reopen_reason text
);

-- ---------------------------------------------------------------------
-- Komunikace a tým
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 200),
  body text not null,
  important boolean not null default false,
  audience text not null default 'all' check (audience in ('all', 'selected')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  category public.contact_category not null,
  name text not null,
  role_label text,
  phone text,
  email text,
  note text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Provoz',
  body text,
  url text,
  storage_path text,
  pinned boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending_idx on public.email_outbox (status, created_at);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null,
  actor uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_table_idx on public.audit_logs (table_name, record_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- Výchozí data číselníků
-- ---------------------------------------------------------------------
insert into public.lesson_types (code, name, credit_multiplier, color, sort_order) values
  ('skolicka',   'Školička bruslení',     2.00, '#0ea5e9', 1),
  ('individual', 'Individuální lekce',    2.50, '#6366f1', 2),
  ('schools',    'Výuka škol a školek',   2.50, '#10b981', 3),
  ('animation',  'Animační program',      1.25, '#f59e0b', 4),
  ('special',    'Speciální akce',        null, '#ec4899', 5),
  ('other',      'Jiný program',          1.00, '#64748b', 6);

insert into public.app_settings (key, value, description) values
  ('cancellation_hours', '48', 'Do kolika hodin před začátkem se instruktor může sám odhlásit ze schválené lekce'),
  ('timezone', '"Europe/Prague"', 'Časové pásmo provozu'),
  ('org_name', '"Kluziště Praha"', 'Název organizace');
