-- Oprava diakritiky ve funkcích (bezpečné spustit opakovaně)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.is_active is distinct from old.is_active or new.id is distinct from old.id
       or new.tier is distinct from old.tier then
      raise exception 'Tuto položku může měnit pouze správce.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.submit_work_report(p_occurrence uuid, p_hours numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_active();
  v_occ public.lesson_occurrences;
  v_a public.instructor_assignments;
  v_id uuid;
begin
  select * into v_occ from public.lesson_occurrences where id = p_occurrence for update;
  if not found then raise exception 'Lekce neexistuje.'; end if;
  if v_occ.status = 'cancelled' then raise exception 'Zrušenou lekci nelze vykázat.'; end if;
  if v_occ.starts_at > now() then raise exception 'Odučený čas lze vykázat až po začátku lekce.'; end if;
  select * into v_a from public.instructor_assignments
    where occurrence_id = p_occurrence and user_id = v_uid and status = 'active';
  if not found then raise exception 'Na této lekci nejste přiřazen(a).'; end if;
  if exists (select 1 from public.attendance_records where assignment_id = v_a.id) then
    raise exception 'Odučený čas už správce schválil. Opravu domluvte se správcem.';
  end if;
  if p_hours is null or p_hours <= 0 or p_hours > 16 then raise exception 'Zadejte odučený čas v hodinách (0–16).'; end if;
  perform public.ensure_period_open(public.period_of(v_occ.starts_at));

  insert into public.work_reports (assignment_id, occurrence_id, user_id, hours, note)
  values (v_a.id, v_occ.id, v_uid, round(p_hours, 2), nullif(trim(p_note), ''))
  on conflict (assignment_id) do update set hours = excluded.hours, note = excluded.note,
    status = 'submitted', updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

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
  v_rate numeric;
  v_credits numeric;
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
  select hourly_rate into v_rate from public.lesson_types where id = v_occ.lesson_type_id;

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

    insert into public.attendance_records (assignment_id, occurrence_id, user_id, lesson_type_id, period,
      status, hours, credit_multiplier, credits, hourly_rate, amount, note, confirmed_by)
    values (v_a.id, v_occ.id, v_a.user_id, v_occ.lesson_type_id, v_period,
      v_status, v_hours, v_occ.credit_multiplier, v_credits, v_rate, round(v_hours * v_rate, 2),
      coalesce(e.note, v_report.note), v_uid)
    on conflict (assignment_id) do update set
      status = excluded.status, hours = excluded.hours, credit_multiplier = excluded.credit_multiplier,
      credits = excluded.credits, hourly_rate = excluded.hourly_rate, amount = excluded.amount,
      note = excluded.note, confirmed_by = excluded.confirmed_by, confirmed_at = now(), updated_at = now()
    returning id into v_att;

    update public.work_reports set status = 'approved', decided_by = v_uid, decided_at = now(), updated_at = now()
      where assignment_id = v_a.id;

    -- kniha kreditů (interní historie) je append-only
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
        v_hours || ' h × ' || v_rate || ' Kč = ' || round(v_hours * v_rate) || ' Kč', '/vykazy');
    end if;
    v_count := v_count + 1;
  end loop;

  update public.lesson_occurrences set status = 'completed', registration_status = 'closed', updated_at = now()
    where id = p_occurrence;
  return v_count;
end $$;

create or replace function public.create_own_lesson(
  p_date date, p_start time, p_end time, p_location uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_active();
  v_type public.lesson_types;
  v_loc public.locations;
  v_lesson uuid;
  v_occ public.lesson_occurrences;
  v_app uuid;
  v_starts timestamptz;
  v_name text;
begin
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'instructor') then
    raise exception 'Vlastní lekce může zapisovat jen instruktor.';
  end if;
  select * into v_type from public.lesson_types where code = 'individual_own';
  if not found then raise exception 'Typ „vlastní klient“ není nastaven.'; end if;
  select * into v_loc from public.locations where id = p_location and is_active;
  if not found then raise exception 'Vyberte kluziště.'; end if;
  if p_end <= p_start then raise exception 'Konec lekce musí být po jejím začátku.'; end if;
  if p_date < (now() at time zone 'Europe/Prague')::date - 31 or p_date > (now() at time zone 'Europe/Prague')::date + 120 then
    raise exception 'Lekci lze zapsat nejvýše měsíc zpětně a 4 měsíce dopředu.';
  end if;
  v_starts := (p_date + p_start) at time zone 'Europe/Prague';
  perform public.ensure_period_open(public.period_of(v_starts));

  insert into public.lessons (title, lesson_type_id, location_id, description, required_instructors,
    credit_multiplier, start_time, end_time, recurrence, registration_deadline_hours, created_by)
  values (v_type.name, v_type.id, v_loc.id, nullif(trim(p_note), ''), 1, v_type.credit_multiplier,
    p_start, p_end, 'none', 0, v_uid)
  returning id into v_lesson;

  insert into public.lesson_occurrences (lesson_id, title, lesson_type_id, location_id, starts_at, ends_at,
    required_instructors, credit_multiplier, description, registration_status, registration_deadline)
  values (v_lesson, v_type.name, v_type.id, v_loc.id, v_starts, (p_date + p_end) at time zone 'Europe/Prague',
    1, v_type.credit_multiplier, nullif(trim(p_note), ''), 'closed', null)
  returning * into v_occ;

  insert into public.lesson_applications (occurrence_id, user_id, status, decided_by, decided_at, decision_note)
  values (v_occ.id, v_uid, 'approved', v_uid, now(), 'Vlastní klient')
  returning id into v_app;
  perform public.insert_assignment(v_occ, v_uid, v_app);

  select trim(first_name || ' ' || last_name) into v_name from public.profiles where id = v_uid;
  perform public.notify_staff('own_lesson', 'Vlastní klient: ' || v_name,
    public.fmt_local(v_starts) || ' · ' || v_loc.name, '/lekce/' || v_occ.id);
  return v_occ.id;
end $$;

create or replace function public._compute_statement(p_user uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month')::date;
  v_hours numeric; v_lessons int; v_program_amount numeric;
  v_lesson_credits numeric; v_bonus_credits numeric; v_other_credits numeric;
  v_bonus_amount numeric;
  rs public.reward_settings;
  v_model text := 'program';
  v_base numeric := 0;
  v_by_type jsonb; v_items jsonb; v_bonuses jsonb;
begin
  select coalesce(sum(ar.hours), 0), count(*) filter (where ar.status <> 'absent'),
         coalesce(sum(coalesce(ar.amount, round(ar.hours * lt.hourly_rate, 2))), 0)
    into v_hours, v_lessons, v_program_amount
    from public.attendance_records ar join public.lesson_types lt on lt.id = ar.lesson_type_id
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
    else v_program_amount
  end;

  select coalesce(jsonb_agg(t order by t.sort_order), '[]') into v_by_type from (
    select lt.id as lesson_type_id, lt.name, lt.color, lt.sort_order,
      sum(ar.hours) as hours, sum(ar.credits) as credits,
      sum(coalesce(ar.amount, round(ar.hours * lt.hourly_rate, 2))) as amount,
      max(coalesce(ar.hourly_rate, lt.hourly_rate)) as hourly_rate,
      count(*) filter (where ar.status <> 'absent') as lessons
    from public.attendance_records ar join public.lesson_types lt on lt.id = ar.lesson_type_id
    where ar.user_id = p_user and ar.period = v_period
    group by lt.id, lt.name, lt.color, lt.sort_order
  ) t;

  select coalesce(jsonb_agg(i order by i.starts_at), '[]') into v_items from (
    select ar.id, o.id as occurrence_id, o.title, o.starts_at, o.ends_at, lt.name as lesson_type,
      l.name as location, ar.status, ar.hours, ar.credit_multiplier, ar.credits,
      coalesce(ar.hourly_rate, lt.hourly_rate) as hourly_rate,
      coalesce(ar.amount, round(ar.hours * lt.hourly_rate, 2)) as amount
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

create or replace function public.suggest_instructors(p_occurrence uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_occ public.lesson_occurrences;
  v_code text;
  v_date date; v_st time; v_et time; v_dow int;
  v_out jsonb;
begin
  perform public.require_staff();
  select * into v_occ from public.lesson_occurrences where id = p_occurrence;
  if not found then raise exception 'Termín lekce neexistuje.'; end if;
  select code into v_code from public.lesson_types where id = v_occ.lesson_type_id;
  v_date := (v_occ.starts_at at time zone 'Europe/Prague')::date;
  v_st := (v_occ.starts_at at time zone 'Europe/Prague')::time;
  v_et := (v_occ.ends_at at time zone 'Europe/Prague')::time;
  v_dow := extract(isodow from v_date);

  select coalesce(jsonb_agg(s order by s.has_conflict, s.score desc, s.month_hours), '[]') into v_out from (
    select x.*,
      (case x.tier when 'main' then 4 when 'development' then 2 else 0 end)
      + (case x.availability when 'preferred' then 3 when 'available' then 2 when 'unavailable' then -6 else 0 end)
      + (case when x.specialization_match then 2 else 0 end)
      + (case when x.application_status in ('pending', 'waitlisted') then 2 else 0 end)
      + (case when x.preferred_location then 1 else 0 end)
      - (case when x.has_conflict then 20 else 0 end) as score
    from (
      select p.id as user_id, trim(p.first_name || ' ' || p.last_name) as name, p.avatar_url, p.tier,
        v_code = any (p.specializations) as specialization_match,
        p.preferred_location_id = v_occ.location_id as preferred_location,
        exists (select 1 from public.instructor_assignments a where a.user_id = p.id and a.status = 'active'
                and a.during && tstzrange(v_occ.starts_at, v_occ.ends_at)) as has_conflict,
        coalesce(
          (select av.kind::text from public.availability av
            where av.user_id = p.id and av.date = v_date
              and (av.start_time is null or (av.start_time < v_et and av.end_time > v_st))
            order by case av.kind when 'unavailable' then 0 when 'preferred' then 1 else 2 end limit 1),
          (select av.kind::text from public.availability av
            where av.user_id = p.id and av.weekday = v_dow
              and (av.start_time is null or (av.start_time < v_et and av.end_time > v_st))
            order by case av.kind when 'unavailable' then 0 when 'preferred' then 1 else 2 end limit 1)
        ) as availability,
        (select ap.status::text from public.lesson_applications ap
          where ap.occurrence_id = p_occurrence and ap.user_id = p.id) as application_status,
        coalesce((select sum(ar.hours) from public.attendance_records ar
          where ar.user_id = p.id and ar.period = public.period_of(v_occ.starts_at)), 0)
        + coalesce((select sum(extract(epoch from (o2.ends_at - o2.starts_at)) / 3600.0)
          from public.instructor_assignments a3 join public.lesson_occurrences o2 on o2.id = a3.occurrence_id
          where a3.user_id = p.id and a3.status = 'active' and o2.status = 'scheduled'
            and public.period_of(o2.starts_at) = public.period_of(v_occ.starts_at)), 0) as month_hours
      from public.profiles p
      where p.is_active
        and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'instructor')
        and not exists (select 1 from public.instructor_assignments a where a.occurrence_id = p_occurrence
                        and a.user_id = p.id and a.status = 'active')
    ) x
  ) s;
  return v_out;
end $$;

create or replace function public.credit_value()
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'credit_value'), 200);
$$;

create or replace function public.lesson_type_rate()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.hourly_rate := round(coalesce(new.credit_multiplier, 1) * public.credit_value(), 2);
  return new;
end $$;

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

create or replace function public.fmt_num(p numeric)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p = trunc(p) then trunc(p)::text
    else rtrim(replace(round(p, 2)::text, '.', ','), '0') end;
$$;

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

