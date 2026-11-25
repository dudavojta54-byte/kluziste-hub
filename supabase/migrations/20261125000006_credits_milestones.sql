-- =====================================================================
-- Odměny zpět podle kreditů programů + odměny za odpracované hodiny
--  • každý program má kredity za hodinu (Školička 2, Individuální 2,5 …)
--  • hodnota kreditu v Kč je jedna pro celý tým (výchozí 200 Kč)
--  • instruktor vidí vše v Kč a hodinách: hodiny × kredity × hodnota kreditu
--  • odměny za odpracované hodiny v sezóně (20 h čepice, 60 h voucher …)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Hodnota kreditu
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('credit_value', '200', 'Hodnota jednoho kreditu v Kč'),
  ('season_start_month', '9', 'Měsíc, kterým začíná sezóna (pro odměny za hodiny)')
on conflict (key) do nothing;

create or replace function public.credit_value()
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'credit_value'), 200);
$$;

-- Sazba programu v Kč se vždy dopočítá z kreditů (needitovat ručně)
create or replace function public.lesson_type_rate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.hourly_rate := round(coalesce(new.credit_multiplier, 1) * public.credit_value(), 2);
  return new;
end $$;

drop trigger if exists lesson_types_rate on public.lesson_types;
create trigger lesson_types_rate before insert or update on public.lesson_types
  for each row execute function public.lesson_type_rate();

-- původní kredity programů
update public.lesson_types set credit_multiplier = case code
  when 'skolicka' then 2.00 when 'individual' then 2.50 when 'individual_own' then 2.50
  when 'schools' then 2.50 when 'animation' then 1.25 when 'special' then coalesce(credit_multiplier, 1)
  when 'other' then 1.00 else coalesce(credit_multiplier, 1) end;
update public.lesson_types set name = 'Speciální akce' where code = 'special' and name = 'Tematický event';

create or replace function public.set_credit_value(p_value numeric)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  if p_value is null or p_value <= 0 or p_value > 10000 then
    raise exception 'Zadejte hodnotu kreditu v Kč (1–10 000).';
  end if;
  insert into public.app_settings (key, value, description)
  values ('credit_value', to_jsonb(round(p_value, 2)), 'Hodnota jednoho kreditu v Kč')
  on conflict (key) do update set value = excluded.value, updated_at = now();
  update public.lesson_types set hourly_rate = hourly_rate;   -- přepočet sazeb triggerem
  return round(p_value, 2);
end $$;

-- přepočet otevřených (neuzavřených) měsíců: částka = kredity × hodnota kreditu
alter table public.attendance_records disable trigger attendance_period_lock;
alter table public.attendance_records disable trigger attendance_records_audit;
update public.attendance_records ar
  set hourly_rate = round(ar.credit_multiplier * public.credit_value(), 2),
      amount = round(ar.credits * public.credit_value(), 2)
  where not exists (select 1 from public.report_periods rp where rp.period = ar.period and rp.status = 'closed');
alter table public.attendance_records enable trigger attendance_period_lock;
alter table public.attendance_records enable trigger attendance_records_audit;

-- číslo česky: 1,5 / 2 / 0
create or replace function public.fmt_num(p numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p = trunc(p) then trunc(p)::text
    else rtrim(replace(round(p, 2)::text, '.', ','), '0') end;
$$;

-- ---------------------------------------------------------------------
-- 2) Potvrzení účasti: částka = hodiny × kredity lekce × hodnota kreditu
-- ---------------------------------------------------------------------
create or replace function public.confirm_attendance(p_occurrence uuid, p_entries jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_occ public.lesson_occurrences;
  v_period date;
  e record;
  v_a public.instructor_assignments;
  v_report public.work_reports;
  v_status public.attendance_status;
  v_planned numeric;
  v_hours numeric;
  v_value numeric := public.credit_value();
  v_rate numeric;
  v_credits numeric;
  v_amount numeric;
  v_att uuid;
  v_existing numeric;
  v_n int;
  v_delta numeric;
  v_count int := 0;
begin
  select * into v_occ from public.lesson_occurrences where id = p_occurrence for update;
  if not found then raise exception 'Termín lekce neexistuje.'; end if;
  if v_occ.status = 'cancelled' then raise exception 'Zrušenou lekci nelze vykázat.'; end if;
  if v_occ.starts_at > now() then raise exception 'Účast lze potvrdit až po začátku lekce.'; end if;
  v_period := public.period_of(v_occ.starts_at);
  perform public.ensure_period_open(v_period);
  v_planned := round(extract(epoch from (v_occ.ends_at - v_occ.starts_at)) / 3600.0, 2);
  v_rate := round(v_occ.credit_multiplier * v_value, 2);

  for e in
    select * from jsonb_to_recordset(p_entries) as x(assignment_id uuid, status text, hours numeric, note text)
  loop
    select * into v_a from public.instructor_assignments
      where id = e.assignment_id and occurrence_id = p_occurrence and status = 'active';
    if not found then raise exception 'Přiřazení % k této lekci neexistuje.', e.assignment_id; end if;
    select * into v_report from public.work_reports where assignment_id = v_a.id;

    v_hours := coalesce(e.hours, v_report.hours, v_planned);
    v_status := coalesce(e.status::public.attendance_status,
                         case when v_hours < v_planned then 'partial' else 'present' end::public.attendance_status);
    if v_status = 'absent' then v_hours := 0; end if;
    if v_hours < 0 or v_hours > 16 then raise exception 'Neplatný počet hodin: %', v_hours; end if;
    v_hours := round(v_hours, 2);
    v_credits := round(v_hours * v_occ.credit_multiplier, 2);
    v_amount := round(v_credits * v_value, 2);

    insert into public.attendance_records (assignment_id, occurrence_id, user_id, lesson_type_id, period,
      status, hours, credit_multiplier, credits, hourly_rate, amount, note, confirmed_by)
    values (v_a.id, v_occ.id, v_a.user_id, v_occ.lesson_type_id, v_period,
      v_status, v_hours, v_occ.credit_multiplier, v_credits, v_rate, v_amount,
      coalesce(e.note, v_report.note), v_uid)
    on conflict (assignment_id) do update set
      status = excluded.status, hours = excluded.hours, credit_multiplier = excluded.credit_multiplier,
      credits = excluded.credits, hourly_rate = excluded.hourly_rate, amount = excluded.amount,
      note = excluded.note, confirmed_by = excluded.confirmed_by, confirmed_at = now(), updated_at = now()
    returning id into v_att;

    update public.work_reports set status = 'approved', decided_by = v_uid, decided_at = now(), updated_at = now()
      where assignment_id = v_a.id;

    select coalesce(sum(credits), 0), count(*) into v_existing, v_n
      from public.credit_ledger where attendance_id = v_att;
    v_delta := v_credits - v_existing;
    if v_delta <> 0 then
      insert into public.credit_ledger (user_id, period, kind, credits, lesson_type_id, attendance_id,
        description, created_by)
      values (v_a.user_id, v_period, case when v_n = 0 then 'lesson' else 'adjustment' end::public.ledger_kind,
        v_delta, v_occ.lesson_type_id, v_att,
        case when v_n = 0 then v_occ.title else 'Oprava výkazu: ' || v_occ.title end, v_uid);
    end if;

    if v_n = 0 or v_delta <> 0 then
      perform public.notify(v_a.user_id, 'attendance_confirmed',
        case when v_n = 0 then 'Odučený čas schválen: ' else 'Výkaz opraven: ' end || v_occ.title,
        public.fmt_num(v_hours) || ' h × ' || round(v_rate) || ' Kč/h = ' || round(v_amount) || ' Kč', '/vykazy');
    end if;
    v_count := v_count + 1;
  end loop;

  update public.lesson_occurrences set status = 'completed', registration_status = 'closed', updated_at = now()
    where id = p_occurrence;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 3) Výkaz: výchozí model počítá z kreditů (částky zafixované při schválení)
-- ---------------------------------------------------------------------
create or replace function public._compute_statement(p_user uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month')::date;
  v_value numeric := public.credit_value();
  v_hours numeric; v_lessons int; v_program_amount numeric;
  v_lesson_credits numeric; v_bonus_credits numeric; v_other_credits numeric;
  v_bonus_amount numeric;
  rs public.reward_settings;
  v_model text := 'program';
  v_base numeric := 0;
  v_by_type jsonb; v_items jsonb; v_bonuses jsonb;
begin
  select coalesce(sum(ar.hours), 0), count(*) filter (where ar.status <> 'absent'),
         coalesce(sum(coalesce(ar.amount, round(ar.credits * v_value, 2))), 0)
    into v_hours, v_lessons, v_program_amount
    from public.attendance_records ar
    where ar.user_id = p_user and ar.period = v_period;
  select coalesce(sum(credits) filter (where attendance_id is not null), 0),
         coalesce(sum(credits) filter (where bonus_id is not null), 0),
         coalesce(sum(credits) filter (where attendance_id is null and bonus_id is null), 0)
    into v_lesson_credits, v_bonus_credits, v_other_credits
    from public.credit_ledger where user_id = p_user and period = v_period;
  select coalesce(sum(amount), 0) into v_bonus_amount
    from public.bonus_records where user_id = p_user and period = v_period and revoked_at is null;

  select * into rs from public.reward_settings
    where user_id = p_user and valid_from < v_end order by valid_from desc limit 1;
  if found then v_model := rs.model::text; end if;
  v_base := case v_model
    when 'credit' then round((v_lesson_credits + v_bonus_credits + v_other_credits) * rs.credit_rate, 2)
    when 'hourly' then round(v_hours * rs.hourly_rate, 2)
    when 'fixed' then rs.fixed_amount
    else v_program_amount + round(v_other_credits * v_value, 2)
  end;

  select coalesce(jsonb_agg(t order by t.sort_order), '[]') into v_by_type from (
    select lt.id as lesson_type_id, lt.name, lt.color, lt.sort_order,
      sum(ar.hours) as hours, sum(ar.credits) as credits,
      sum(coalesce(ar.amount, round(ar.credits * v_value, 2))) as amount,
      max(coalesce(ar.hourly_rate, round(ar.credit_multiplier * v_value, 2))) as hourly_rate,
      count(*) filter (where ar.status <> 'absent') as lessons
    from public.attendance_records ar join public.lesson_types lt on lt.id = ar.lesson_type_id
    where ar.user_id = p_user and ar.period = v_period
    group by lt.id, lt.name, lt.color, lt.sort_order
  ) t;

  select coalesce(jsonb_agg(i order by i.starts_at), '[]') into v_items from (
    select ar.id, o.id as occurrence_id, o.title, o.starts_at, o.ends_at, lt.name as lesson_type,
      l.name as location, ar.status, ar.hours, ar.credit_multiplier, ar.credits,
      coalesce(ar.hourly_rate, round(ar.credit_multiplier * v_value, 2)) as hourly_rate,
      coalesce(ar.amount, round(ar.credits * v_value, 2)) as amount
    from public.attendance_records ar
    join public.lesson_occurrences o on o.id = ar.occurrence_id
    join public.lesson_types lt on lt.id = ar.lesson_type_id
    join public.locations l on l.id = o.location_id
    where ar.user_id = p_user and ar.period = v_period
  ) i;

  select coalesce(jsonb_agg(b order by b.awarded_on), '[]') into v_bonuses from (
    select id, reason, reason_text, awarded_on, credits, amount
    from public.bonus_records where user_id = p_user and period = v_period and revoked_at is null
  ) b;

  return jsonb_build_object(
    'user_id', p_user,
    'period', v_period,
    'hours', v_hours,
    'lessons', v_lessons,
    'credit_value', v_value,
    'program_amount', v_program_amount,
    'lesson_credits', v_lesson_credits + v_other_credits,
    'bonus_credits', v_bonus_credits,
    'total_credits', v_lesson_credits + v_bonus_credits + v_other_credits,
    'bonus_amount', v_bonus_amount,
    'model', v_model,
    'credit_rate', rs.credit_rate,
    'hourly_rate', rs.hourly_rate,
    'fixed_amount', rs.fixed_amount,
    'monthly_credit_target', rs.monthly_credit_target,
    'base_amount', v_base,
    'total_amount', v_base + v_bonus_amount,
    'by_type', v_by_type,
    'items', v_items,
    'bonuses', v_bonuses
  );
end $$;

-- ---------------------------------------------------------------------
-- 4) Odměny za odpracované hodiny v sezóně
-- ---------------------------------------------------------------------
create table if not exists public.hour_milestones (
  id uuid primary key default gen_random_uuid(),
  hours numeric(6, 1) not null unique check (hours > 0),
  title text not null,
  description text,
  icon text not null default '🎁',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.milestone_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  milestone_id uuid not null references public.hour_milestones (id) on delete cascade,
  season date not null,
  reached_at timestamptz not null default now(),
  handed_at timestamptz,
  handed_by uuid references public.profiles (id),
  unique (user_id, milestone_id, season)
);

alter table public.hour_milestones enable row level security;
alter table public.milestone_awards enable row level security;
create policy hour_milestones_select on public.hour_milestones for select to authenticated
  using (public.current_user_active());
create policy hour_milestones_admin on public.hour_milestones for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy milestone_awards_select on public.milestone_awards for select to authenticated
  using ((user_id = auth.uid() and public.current_user_active()) or public.is_staff());
grant select on public.hour_milestones, public.milestone_awards to authenticated;
grant insert, update, delete on public.hour_milestones to authenticated;
grant all on public.hour_milestones, public.milestone_awards to service_role;

create trigger hour_milestones_audit after insert or update or delete on public.hour_milestones
  for each row execute function public.audit_trigger();
create trigger milestone_awards_audit after insert or update or delete on public.milestone_awards
  for each row execute function public.audit_trigger();

insert into public.hour_milestones (hours, icon, title, description) values
  (10,  '⛸️', 'Odznak Kluziště Praha', 'Odznak a nášivka na bundu – vítej v týmu.'),
  (20,  '🧢', 'Zimní čepice', 'Teplá týmová čepice s logem.'),
  (40,  '☕', 'Termohrnek + broušení bruslí', 'Týmový termohrnek a jedno broušení bruslí zdarma.'),
  (60,  '🍽️', 'Voucher do restaurace', 'Poukázka na večeři v hodnotě 1 000 Kč.'),
  (80,  '🧥', 'Instruktorská mikina', 'Mikina s logem a jménem.'),
  (100, '🎟️', 'Zážitkový poukaz', 'Poukaz na zážitek v hodnotě 1 500 Kč (wellness, lanovka, escape room …).'),
  (150, '🏆', 'Instruktor sezóny', 'Finanční bonus 3 000 Kč a pozvánka na týmovou večeři.')
on conflict (hours) do nothing;

create or replace function public.season_start(p_at timestamptz default now())
returns date language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'season_start_month'), 9) as m,
           (p_at at time zone 'Europe/Prague')::date as d
  )
  select make_date(extract(year from d)::int - case when extract(month from d) < m then 1 else 0 end, m, 1) from s;
$$;

create or replace function public.season_hours(p_user uuid, p_season date)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(hours), 0) from public.attendance_records
  where user_id = p_user and status <> 'absent'
    and period >= p_season and period < (p_season + interval '1 year')::date;
$$;

-- Při schválení hodin: zapsat nově dosažené odměny a poslat oznámení
create or replace function public.check_milestones()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_season date := public.season_start(new.period::timestamp at time zone 'Europe/Prague');
  v_hours numeric;
  m record;
begin
  v_hours := public.season_hours(new.user_id, v_season);
  for m in
    select * from public.hour_milestones hm where hm.is_active and hm.hours <= v_hours
      and not exists (select 1 from public.milestone_awards a
                      where a.user_id = new.user_id and a.milestone_id = hm.id and a.season = v_season)
    order by hm.hours
  loop
    insert into public.milestone_awards (user_id, milestone_id, season) values (new.user_id, m.id, v_season);
    perform public.notify(new.user_id, 'milestone', m.icon || ' Odměna za ' || m.hours::int || ' h: ' || m.title,
      'Gratulujeme! ' || coalesce(m.description, '') || ' Předání domluvte se správcem.', '/');
  end loop;
  return null;
end $$;

drop trigger if exists attendance_milestones on public.attendance_records;
create trigger attendance_milestones after insert or update of hours, status on public.attendance_records
  for each row execute function public.check_milestones();

-- Přehled pro instruktora
create or replace function public.my_milestones()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_active();
  v_season date := public.season_start();
begin
  return jsonb_build_object(
    'season', v_season,
    'hours', public.season_hours(v_uid, v_season),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'hours', m.hours, 'icon', m.icon, 'title', m.title,
        'description', m.description, 'reached_at', a.reached_at, 'handed_at', a.handed_at) order by m.hours)
      from public.hour_milestones m
      left join public.milestone_awards a on a.milestone_id = m.id and a.user_id = v_uid and a.season = v_season
      where m.is_active), '[]'::jsonb)
  );
end $$;

-- Přehled pro správce: kdo kolik odpracoval a co je potřeba předat
create or replace function public.milestone_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_season date := public.season_start();
begin
  perform public.require_staff();
  return jsonb_build_object(
    'season', v_season,
    'to_hand', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id,
        'name', trim(p.first_name || ' ' || p.last_name), 'icon', m.icon, 'title', m.title, 'hours', m.hours,
        'reached_at', a.reached_at) order by a.reached_at)
      from public.milestone_awards a
      join public.hour_milestones m on m.id = a.milestone_id
      join public.profiles p on p.id = a.user_id
      where a.season = v_season and a.handed_at is null), '[]'::jsonb),
    'instructors', coalesce((
      select jsonb_agg(x order by x.hours desc) from (
        select p.id as user_id, trim(p.first_name || ' ' || p.last_name) as name,
          public.season_hours(p.id, v_season) as hours
        from public.profiles p
        where p.is_active and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'instructor')
      ) x), '[]'::jsonb)
  );
end $$;

create or replace function public.hand_over_milestone(p_award uuid, p_handed boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
begin
  update public.milestone_awards
    set handed_at = case when p_handed then now() end, handed_by = case when p_handed then v_uid end
    where id = p_award;
  if not found then raise exception 'Odměna neexistuje.'; end if;
end $$;

-- dorovnat odměny pro hodiny, které už jsou schválené
insert into public.milestone_awards (user_id, milestone_id, season)
select x.user_id, m.id, x.season
from (
  select ar.user_id, public.season_start(ar.period::timestamp at time zone 'Europe/Prague') as season, sum(ar.hours) as hours
  from public.attendance_records ar where ar.status <> 'absent'
  group by 1, 2
) x
join public.hour_milestones m on m.is_active and m.hours <= x.hours
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Oprávnění
-- ---------------------------------------------------------------------
revoke execute on function public.set_credit_value(numeric) from public, anon;
revoke execute on function public.my_milestones() from public, anon;
revoke execute on function public.milestone_overview() from public, anon;
revoke execute on function public.hand_over_milestone(uuid, boolean) from public, anon;
revoke execute on function public.season_hours(uuid, date) from public, anon, authenticated;
revoke execute on function public.check_milestones() from public, anon, authenticated;
grant execute on function public.set_credit_value(numeric) to authenticated, service_role;
grant execute on function public.my_milestones() to authenticated, service_role;
grant execute on function public.milestone_overview() to authenticated, service_role;
grant execute on function public.hand_over_milestone(uuid, boolean) to authenticated, service_role;
grant execute on function public.credit_value() to authenticated, service_role;
grant execute on function public.season_start(timestamptz) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'milestone_awards') then
      alter publication supabase_realtime add table public.milestone_awards;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'hour_milestones') then
      alter publication supabase_realtime add table public.hour_milestones;
    end if;
  end if;
end $$;
