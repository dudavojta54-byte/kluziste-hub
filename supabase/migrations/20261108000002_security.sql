-- =====================================================================
-- Pomocné funkce pro oprávnění + Row Level Security
-- =====================================================================

create or replace function public.current_user_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and p.is_active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('admin');
$$;

-- admin nebo koordinátor (plánování a schvalování)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('admin') or public.has_role('coordinator');
$$;

create or replace function public.my_roles()
returns public.app_role[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(ur.role order by ur.role), '{}')
  from public.user_roles ur join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active;
$$;

create or replace function public.period_of(ts timestamptz)
returns date language sql stable as $$
  select date_trunc('month', ts at time zone 'Europe/Prague')::date;
$$;

-- ---------------------------------------------------------------------
-- Zapnutí RLS na všech tabulkách
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.user_roles enable row level security;
alter table public.locations enable row level security;
alter table public.lesson_types enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_occurrences enable row level security;
alter table public.lesson_applications enable row level security;
alter table public.instructor_assignments enable row level security;
alter table public.availability enable row level security;
alter table public.attendance_records enable row level security;
alter table public.bonus_records enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.reward_settings enable row level security;
alter table public.report_periods enable row level security;
alter table public.notifications enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.contacts enable row level security;
alter table public.documents enable row level security;
alter table public.email_outbox enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------
-- Profily: týmový profil vidí všichni aktivní členové, upravuje vlastník a admin
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_user_active());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.current_user_active()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Soukromé a účetní údaje: jen vlastník a admin
create policy profile_private_select on public.profile_private for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy profile_private_insert on public.profile_private for insert to authenticated
  with check ((user_id = auth.uid() and public.current_user_active()) or public.is_admin());
create policy profile_private_update on public.profile_private for update to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_admin())
  with check ((user_id = auth.uid()) or public.is_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.current_user_active());
create policy user_roles_admin_all on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Číselníky: čtou všichni aktivní, mění admin
-- ---------------------------------------------------------------------
create policy locations_select on public.locations for select to authenticated
  using (public.current_user_active());
create policy locations_admin on public.locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy lesson_types_select on public.lesson_types for select to authenticated
  using (public.current_user_active());
create policy lesson_types_admin on public.lesson_types for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy app_settings_select on public.app_settings for select to authenticated
  using (public.current_user_active());
create policy app_settings_admin on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Lekce: čtou všichni aktivní (veřejně viditelné programy).
-- Zápis výhradně přes RPC funkce (kontrola rolí + atomicita).
-- ---------------------------------------------------------------------
create policy lessons_select on public.lessons for select to authenticated
  using (public.current_user_active());
create policy occurrences_select on public.lesson_occurrences for select to authenticated
  using (public.current_user_active());

create policy applications_select on public.lesson_applications for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_staff());

-- obsazení lekcí je týmová informace (kdo jede se mnou)
create policy assignments_select on public.instructor_assignments for select to authenticated
  using (public.current_user_active());

-- ---------------------------------------------------------------------
-- Dostupnost: vlastník spravuje, staff čte
-- ---------------------------------------------------------------------
create policy availability_select on public.availability for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_staff());
create policy availability_insert on public.availability for insert to authenticated
  with check (user_id = auth.uid() and public.current_user_active());
create policy availability_update on public.availability for update to authenticated
  using (user_id = auth.uid() and public.current_user_active())
  with check (user_id = auth.uid());
create policy availability_delete on public.availability for delete to authenticated
  using (user_id = auth.uid() and public.current_user_active());

-- ---------------------------------------------------------------------
-- Výkony: docházka a kredity vidí vlastník + staff; peníze jen vlastník + admin
-- ---------------------------------------------------------------------
create policy attendance_select on public.attendance_records for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_staff());
create policy ledger_select on public.credit_ledger for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_staff());
create policy bonus_select on public.bonus_records for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_admin());
create policy reward_settings_select on public.reward_settings for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_admin());
create policy reward_settings_admin on public.reward_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy report_periods_select on public.report_periods for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- Komunikace
-- ---------------------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

create policy announcements_select on public.announcements for select to authenticated
  using (
    public.is_staff()
    or (public.current_user_active() and exists (
      select 1 from public.announcement_recipients r
      where r.announcement_id = announcements.id and r.user_id = auth.uid()))
  );
create policy announcement_recipients_select on public.announcement_recipients for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create policy contacts_select on public.contacts for select to authenticated
  using (public.current_user_active());
create policy contacts_admin on public.contacts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy documents_select on public.documents for select to authenticated
  using (public.current_user_active());
create policy documents_admin on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_admin());

-- email_outbox: žádná politika => přístup jen pro service role (cron)

-- ---------------------------------------------------------------------
-- Ochrana citlivých sloupců profilu před změnou samotným uživatelem
-- ---------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.is_active is distinct from old.is_active or new.id is distinct from old.id then
      raise exception 'Tuto položku může měnit pouze správce.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------
-- Nový uživatel z Supabase Auth => profil + role instruktor.
-- Vyšší role nastavuje výhradně admin (server action / tabulka user_roles).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, first_name, last_name, team_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    new.email
  )
  on conflict (id) do nothing;
  insert into public.profile_private (user_id) values (new.id) on conflict do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'instructor') on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
