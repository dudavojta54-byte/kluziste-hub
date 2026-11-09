-- =====================================================================
-- Business logika (RPC). Všechny zápisy citlivých dat jdou přes tyto
-- funkce: kontrola oprávnění, atomicita (řádkové zámky) a audit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Interní pomocné funkce
-- ---------------------------------------------------------------------
create or replace function public.require_active()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_active() then
    raise exception 'Nejste přihlášen(a) nebo je váš účet deaktivován.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.require_staff()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_staff() then
    raise exception 'K této akci nemáte oprávnění.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.require_admin()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Tuto akci může provést pouze správce.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.fmt_local(ts timestamptz)
returns text language sql stable as $$
  select to_char(ts at time zone 'Europe/Prague', 'DD.MM.YYYY HH24:MI');
$$;

create or replace function public.notify(
  p_user uuid, p_type text, p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, p_type, p_title, p_body, p_link);
end $$;

create or replace function public.notify_staff(
  p_type text, p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select distinct p.id, p_type, p_title, p_body, p_link
  from public.profiles p join public.user_roles ur on ur.user_id = p.id
  where p.is_active and ur.role in ('admin', 'coordinator')
    and p.id is distinct from auth.uid();
end $$;

create or replace function public.ensure_period_open(p_period date)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.report_periods
             where period = date_trunc('month', p_period)::date and status = 'closed') then
    raise exception 'Měsíc % je uzavřen. Změny jsou možné až po jeho znovuotevření správcem.',
      to_char(p_period, 'MM/YYYY') using errcode = 'P0001', hint = 'PERIOD_CLOSED';
  end if;
end $$;

create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------
-- Lekce
-- ---------------------------------------------------------------------
-- p: { title, lesson_type_id, location_id, description, instructions,
--      required_instructors, credit_multiplier, start_time "HH:MM", end_time,
--      dates ["YYYY-MM-DD", ...], recurrence, registration_status,
--      registration_deadline_hours, notify }
create or replace function public.create_lesson(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_type public.lesson_types;
  v_mult numeric;
  v_lesson uuid;
  v_start time := (p ->> 'start_time')::time;
  v_end time := (p ->> 'end_time')::time;
  v_dates date[];
  v_d date;
  v_first uuid;
  v_occ uuid;
  v_starts timestamptz;
  v_deadline_h int := coalesce((p ->> 'registration_deadline_hours')::int, 24);
  v_reg public.registration_status := coalesce((p ->> 'registration_status')::public.registration_status, 'open');
  v_required int := coalesce((p ->> 'required_instructors')::int, 1);
  v_loc public.locations;
  v_future int := 0;
begin
  select * into v_type from public.lesson_types where id = (p ->> 'lesson_type_id')::uuid;
  if not found then raise exception 'Neznámý typ programu.'; end if;
  select * into v_loc from public.locations where id = (p ->> 'location_id')::uuid;
  if not found then raise exception 'Neznámá lokalita.'; end if;

  v_mult := coalesce((p ->> 'credit_multiplier')::numeric, v_type.credit_multiplier);
  if v_mult is null then
    raise exception 'U programu „%“ je nutné zadat kreditový násobek.', v_type.name;
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'Konec lekce musí být po jejím začátku.';
  end if;

  select array_agg(d order by d) into v_dates
  from (select distinct value::date as d from jsonb_array_elements_text(coalesce(p -> 'dates', '[]'))) s;
  if v_dates is null or array_length(v_dates, 1) = 0 then
    raise exception 'Zadejte alespoň jeden termín.';
  end if;
  if array_length(v_dates, 1) > 200 then
    raise exception 'Najednou lze vytvořit nejvýše 200 termínů.';
  end if;

  insert into public.lessons (title, lesson_type_id, location_id, description, instructions,
    required_instructors, credit_multiplier, start_time, end_time, recurrence,
    registration_deadline_hours, created_by)
  values (trim(p ->> 'title'), v_type.id, v_loc.id, p ->> 'description', p ->> 'instructions',
    v_required, v_mult, v_start, v_end,
    case when array_length(v_dates, 1) = 1 then 'none' else coalesce(p ->> 'recurrence', 'custom') end,
    v_deadline_h, v_uid)
  returning id into v_lesson;

  foreach v_d in array v_dates loop
    v_starts := (v_d + v_start) at time zone 'Europe/Prague';
    insert into public.lesson_occurrences (lesson_id, title, lesson_type_id, location_id,
      starts_at, ends_at, required_instructors, credit_multiplier, description, instructions,
      registration_status, registration_deadline)
    values (v_lesson, trim(p ->> 'title'), v_type.id, v_loc.id,
      v_starts, (v_d + v_end) at time zone 'Europe/Prague', v_required, v_mult,
      p ->> 'description', p ->> 'instructions', v_reg,
      v_starts - make_interval(hours => v_deadline_h))
    returning id into v_occ;
    v_first := coalesce(v_first, v_occ);
    if v_starts > now() then v_future := v_future + 1; end if;
  end loop;

  -- upozornění na novou volnou lekci
  if v_reg = 'open' and v_future > 0 and coalesce((p ->> 'notify')::boolean, true) then
    insert into public.notifications (user_id, type, title, body, link)
    select distinct pr.id, 'lesson_new', 'Nová lekce: ' || trim(p ->> 'title'),
      case when v_future = 1
        then public.fmt_local((v_dates[1] + v_start) at time zone 'Europe/Prague') || ' · ' || v_loc.name
        else v_future || ' termínů od ' || to_char(v_dates[1], 'DD.MM.YYYY') || ' · ' || v_loc.name end,
      '/lekce/' || v_first
    from public.profiles pr join public.user_roles ur on ur.user_id = pr.id
    where pr.is_active and ur.role = 'instructor' and pr.id <> v_uid;
  end if;

  return v_lesson;
end $$;

-- p: libovolná podmnožina { title, lesson_type_id, location_id, description, instructions,
--    required_instructors, credit_multiplier, date, start_time, end_time,
--    registration_status, registration_deadline_hours }
-- p_scope: 'single' | 'series' (tento a všechny budoucí termíny série)
create or replace function public.update_occurrence(p_id uuid, p jsonb, p_scope text default 'single')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_base public.lesson_occurrences;
  t public.lesson_occurrences;
  v_date date; v_st time; v_et time;
  v_new_start timestamptz; v_new_end timestamptz;
  v_required int; v_active int; v_count int := 0;
  v_changed boolean;
begin
  select * into v_base from public.lesson_occurrences where id = p_id for update;
  if not found then raise exception 'Termín lekce neexistuje.'; end if;
  if v_base.status <> 'scheduled' then
    raise exception 'Zrušený nebo dokončený termín nelze upravovat.';
  end if;

  for t in
    select * from public.lesson_occurrences o
    where (p_scope = 'series' and o.lesson_id = v_base.lesson_id and o.starts_at >= v_base.starts_at
           and o.status = 'scheduled')
       or o.id = p_id
    order by o.starts_at
    for update
  loop
    v_date := case when p_scope = 'single' and p ? 'date' then (p ->> 'date')::date
                   else (t.starts_at at time zone 'Europe/Prague')::date end;
    v_st := coalesce((p ->> 'start_time')::time, (t.starts_at at time zone 'Europe/Prague')::time);
    v_et := coalesce((p ->> 'end_time')::time, (t.ends_at at time zone 'Europe/Prague')::time);
    if v_et <= v_st then raise exception 'Konec lekce musí být po jejím začátku.'; end if;
    v_new_start := (v_date + v_st) at time zone 'Europe/Prague';
    v_new_end := (v_date + v_et) at time zone 'Europe/Prague';

    v_required := coalesce((p ->> 'required_instructors')::int, t.required_instructors);
    select count(*) into v_active from public.instructor_assignments
      where occurrence_id = t.id and status = 'active';
    if v_required < v_active then
      raise exception 'Termín % má již % přiřazených instruktorů – kapacitu nelze snížit pod tento počet.',
        public.fmt_local(t.starts_at), v_active;
    end if;

    v_changed := v_new_start <> t.starts_at or v_new_end <> t.ends_at
      or coalesce((p ->> 'location_id')::uuid, t.location_id) <> t.location_id;

    update public.lesson_occurrences set
      title = coalesce(nullif(trim(p ->> 'title'), ''), title),
      lesson_type_id = coalesce((p ->> 'lesson_type_id')::uuid, lesson_type_id),
      location_id = coalesce((p ->> 'location_id')::uuid, location_id),
      description = case when p ? 'description' then p ->> 'description' else description end,
      instructions = case when p ? 'instructions' then p ->> 'instructions' else instructions end,
      required_instructors = v_required,
      credit_multiplier = coalesce((p ->> 'credit_multiplier')::numeric, credit_multiplier),
      registration_status = coalesce((p ->> 'registration_status')::public.registration_status, registration_status),
      registration_deadline = case
        when p ? 'registration_deadline_hours'
          then v_new_start - make_interval(hours => (p ->> 'registration_deadline_hours')::int)
        else registration_deadline + (v_new_start - starts_at) end,
      starts_at = v_new_start,
      ends_at = v_new_end,
      updated_at = now()
    where id = t.id;

    if v_changed then
      insert into public.notifications (user_id, type, title, body, link)
      select a.user_id, 'lesson_changed', 'Změna lekce: ' || t.title,
        'Nový termín: ' || public.fmt_local(v_new_start) || ' – ' ||
        to_char(v_new_end at time zone 'Europe/Prague', 'HH24:MI') ||
        coalesce(' · ' || (select name from public.locations where id = coalesce((p ->> 'location_id')::uuid, t.location_id)), ''),
        '/lekce/' || t.id
      from public.instructor_assignments a
      where a.occurrence_id = t.id and a.status = 'active' and a.user_id <> v_uid;
    end if;
    v_count := v_count + 1;
  end loop;

  if p_scope = 'series' then
    update public.lessons set
      title = coalesce(nullif(trim(p ->> 'title'), ''), title),
      lesson_type_id = coalesce((p ->> 'lesson_type_id')::uuid, lesson_type_id),
      location_id = coalesce((p ->> 'location_id')::uuid, location_id),
      description = case when p ? 'description' then p ->> 'description' else description end,
      instructions = case when p ? 'instructions' then p ->> 'instructions' else instructions end,
      required_instructors = coalesce((p ->> 'required_instructors')::int, required_instructors),
      credit_multiplier = coalesce((p ->> 'credit_multiplier')::numeric, credit_multiplier),
      start_time = coalesce((p ->> 'start_time')::time, start_time),
      end_time = coalesce((p ->> 'end_time')::time, end_time),
      registration_deadline_hours = coalesce((p ->> 'registration_deadline_hours')::int, registration_deadline_hours),
      updated_at = now()
    where id = v_base.lesson_id;
  end if;

  return v_count;
end $$;

create or replace function public.cancel_occurrence(p_id uuid, p_reason text, p_scope text default 'single')
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_base public.lesson_occurrences;
  t public.lesson_occurrences;
  v_count int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Uveďte důvod zrušení.'; end if;
  select * into v_base from public.lesson_occurrences where id = p_id for update;
  if not found then raise exception 'Termín lekce neexistuje.'; end if;
  if v_base.status <> 'scheduled' then raise exception 'Termín již není aktivní.'; end if;

  for t in
    select * from public.lesson_occurrences o
    where ((p_scope = 'series' and o.lesson_id = v_base.lesson_id and o.starts_at >= v_base.starts_at)
           or o.id = p_id) and o.status = 'scheduled'
    for update
  loop
    -- upozornit všechny přiřazené i čekající
    insert into public.notifications (user_id, type, title, body, link)
    select distinct x.user_id, 'lesson_cancelled', 'Zrušeno: ' || t.title,
      public.fmt_local(t.starts_at) || ' · Důvod: ' || p_reason, '/lekce/' || t.id
    from (
      select user_id from public.instructor_assignments where occurrence_id = t.id and status = 'active'
      union
      select user_id from public.lesson_applications
        where occurrence_id = t.id and status in ('pending', 'waitlisted', 'cancel_requested')
    ) x where x.user_id <> v_uid;

    update public.instructor_assignments set status = 'cancelled', cancelled_at = now()
      where occurrence_id = t.id and status = 'active';
    update public.lesson_applications set status = 'rejected', decided_by = v_uid,
      decided_at = now(), decision_note = 'Lekce zrušena: ' || p_reason, updated_at = now()
      where occurrence_id = t.id and status in ('pending', 'waitlisted', 'cancel_requested');
    update public.lesson_occurrences set status = 'cancelled', cancel_reason = p_reason,
      registration_status = 'closed', updated_at = now()
      where id = t.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Přihlášky a obsazení
-- ---------------------------------------------------------------------
create or replace function public.promote_waitlist(p_occurrence uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_occ public.lesson_occurrences;
  v_taken int;
  v_app public.lesson_applications;
  v_promoted int := 0;
begin
  select * into v_occ from public.lesson_occurrences where id = p_occurrence;
  if v_occ.status <> 'scheduled' or v_occ.starts_at <= now() then return 0; end if;
  loop
    select (select count(*) from public.instructor_assignments where occurrence_id = p_occurrence and status = 'active')
         + (select count(*) from public.lesson_applications where occurrence_id = p_occurrence and status = 'pending')
      into v_taken;
    exit when v_taken >= v_occ.required_instructors;
    select * into v_app from public.lesson_applications
      where occurrence_id = p_occurrence and status = 'waitlisted'
      order by created_at limit 1 for update;
    exit when not found;
    update public.lesson_applications set status = 'pending', updated_at = now() where id = v_app.id;
    perform public.notify(v_app.user_id, 'waitlist_promoted', 'Uvolnilo se místo: ' || v_occ.title,
      'Vaše přihláška z náhradníků čeká na schválení. ' || public.fmt_local(v_occ.starts_at),
      '/lekce/' || v_occ.id);
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end $$;

create or replace function public.apply_to_occurrence(p_occurrence uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_active();
  v_occ public.lesson_occurrences;
  v_app public.lesson_applications;
  v_taken int;
  v_status public.application_status;
  v_id uuid;
  v_name text;
begin
  -- zámek termínu: souběžné přihlášky na poslední místo se seřadí
  select * into v_occ from public.lesson_occurrences where id = p_occurrence for update;
  if not found then raise exception 'Lekce neexistuje.'; end if;
  if v_occ.status <> 'scheduled' then raise exception 'Lekce není aktivní.'; end if;
  if v_occ.registration_status <> 'open' then raise exception 'Přihlašování na tuto lekci je uzavřeno.'; end if;
  if v_occ.starts_at <= now() then raise exception 'Lekce již začala.'; end if;
  if v_occ.registration_deadline is not null and now() > v_occ.registration_deadline then
    raise exception 'Uzávěrka přihlášek již uplynula.';
  end if;

  if exists (select 1 from public.instructor_assignments a
             where a.user_id = v_uid and a.status = 'active'
               and a.during && tstzrange(v_occ.starts_at, v_occ.ends_at)) then
    raise exception 'V tomto čase již máte potvrzenou jinou lekci.' using hint = 'CONFLICT';
  end if;

  select * into v_app from public.lesson_applications
    where occurrence_id = p_occurrence and user_id = v_uid for update;
  if found then
    if v_app.status in ('pending', 'waitlisted', 'approved', 'cancel_requested') then
      raise exception 'Na tuto lekci jste již přihlášen(a).' using hint = 'DUPLICATE';
    elsif v_app.status = 'rejected' then
      raise exception 'Vaše přihláška na tuto lekci byla zamítnuta. Kontaktujte koordinátora.';
    end if;
  end if;

  select (select count(*) from public.instructor_assignments where occurrence_id = p_occurrence and status = 'active')
       + (select count(*) from public.lesson_applications
            where occurrence_id = p_occurrence and status = 'pending' and user_id <> v_uid)
    into v_taken;
  v_status := case when v_taken >= v_occ.required_instructors then 'waitlisted' else 'pending' end;

  if v_app.id is not null then
    update public.lesson_applications set status = v_status, note = p_note, decided_by = null,
      decided_at = null, decision_note = null, created_at = now(), updated_at = now()
      where id = v_app.id returning id into v_id;
  else
    insert into public.lesson_applications (occurrence_id, user_id, status, note)
    values (p_occurrence, v_uid, v_status, p_note) returning id into v_id;
  end if;

  select trim(first_name || ' ' || last_name) into v_name from public.profiles where id = v_uid;
  perform public.notify_staff('application_new',
    case when v_status = 'waitlisted' then 'Náhradník: ' else 'Nová přihláška: ' end || v_occ.title,
    v_name || ' · ' || public.fmt_local(v_occ.starts_at), '/prihlasky');

  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;

create or replace function public.insert_assignment(p_occ public.lesson_occurrences, p_user uuid, p_app uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  begin
    insert into public.instructor_assignments (occurrence_id, user_id, application_id, during, assigned_by)
    values (p_occ.id, p_user, p_app, tstzrange(p_occ.starts_at, p_occ.ends_at), auth.uid())
    returning id into v_id;
  exception
    when exclusion_violation then
      raise exception 'Instruktor má v tomto čase jinou potvrzenou lekci.' using hint = 'CONFLICT';
    when unique_violation then
      raise exception 'Instruktor je již na tuto lekci přiřazen.' using hint = 'DUPLICATE';
  end;
  return v_id;
end $$;

create or replace function public.approve_application(p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_occ_id uuid;
  v_occ public.lesson_occurrences;
  v_app public.lesson_applications;
  v_active int;
  v_assignment uuid;
begin
  select occurrence_id into v_occ_id from public.lesson_applications where id = p_id;
  if not found then raise exception 'Přihláška neexistuje.'; end if;
  -- zámky vždy v pořadí termín -> přihláška (bez deadlocků)
  select * into v_occ from public.lesson_occurrences where id = v_occ_id for update;
  select * into v_app from public.lesson_applications where id = p_id for update;

  if v_app.status not in ('pending', 'waitlisted') then
    raise exception 'Přihlášku ve stavu „%“ nelze schválit.', v_app.status;
  end if;
  if v_occ.status <> 'scheduled' then raise exception 'Lekce není aktivní.'; end if;
  if not exists (select 1 from public.profiles where id = v_app.user_id and is_active) then
    raise exception 'Účet instruktora je deaktivován.';
  end if;

  select count(*) into v_active from public.instructor_assignments
    where occurrence_id = v_occ.id and status = 'active';
  if v_active >= v_occ.required_instructors then
    raise exception 'Lekce je již plně obsazena.' using hint = 'FULL';
  end if;

  v_assignment := public.insert_assignment(v_occ, v_app.user_id, v_app.id);

  update public.lesson_applications set status = 'approved', decided_by = v_uid,
    decided_at = now(), updated_at = now() where id = p_id;

  perform public.notify(v_app.user_id, 'application_approved', 'Přihláška schválena: ' || v_occ.title,
    public.fmt_local(v_occ.starts_at) || ' · lekce je ve vašem rozvrhu', '/lekce/' || v_occ.id);

  -- lekce je plná => ostatní čekající přesunout mezi náhradníky
  if v_active + 1 >= v_occ.required_instructors then
    update public.lesson_applications set status = 'waitlisted', updated_at = now()
      where occurrence_id = v_occ.id and status = 'pending';
  end if;
  return v_assignment;
end $$;

create or replace function public.reject_application(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_app public.lesson_applications;
  v_occ public.lesson_occurrences;
begin
  select * into v_app from public.lesson_applications where id = p_id;
  if not found then raise exception 'Přihláška neexistuje.'; end if;
  select * into v_occ from public.lesson_occurrences where id = v_app.occurrence_id for update;
  select * into v_app from public.lesson_applications where id = p_id for update;
  if v_app.status not in ('pending', 'waitlisted') then
    raise exception 'Přihlášku ve stavu „%“ nelze zamítnout.', v_app.status;
  end if;
  update public.lesson_applications set status = 'rejected', decided_by = v_uid, decided_at = now(),
    decision_note = p_note, updated_at = now() where id = p_id;
  perform public.notify(v_app.user_id, 'application_rejected', 'Přihláška zamítnuta: ' || v_occ.title,
    public.fmt_local(v_occ.starts_at) || coalesce(' · ' || p_note, ''), '/lekce/' || v_occ.id);
  perform public.promote_waitlist(v_occ.id);
end $$;

create or replace function public.withdraw_application(p_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_active();
  v_app public.lesson_applications;
  v_occ public.lesson_occurrences;
  v_hours int := public.setting_int('cancellation_hours', 48);
  v_name text;
begin
  select * into v_app from public.lesson_applications where id = p_id;
  if not found or v_app.user_id <> v_uid then raise exception 'Přihláška neexistuje.'; end if;
  select * into v_occ from public.lesson_occurrences where id = v_app.occurrence_id for update;
  select * into v_app from public.lesson_applications where id = p_id for update;
  select trim(first_name || ' ' || last_name) into v_name from public.profiles where id = v_uid;

  if v_app.status in ('pending', 'waitlisted') then
    update public.lesson_applications set status = 'withdrawn', updated_at = now() where id = p_id;
    perform public.promote_waitlist(v_occ.id);
    return 'withdrawn';
  elsif v_app.status = 'approved' then
    if v_occ.starts_at <= now() then raise exception 'Lekce již začala.'; end if;
    if v_occ.starts_at - now() >= make_interval(hours => v_hours) then
      update public.instructor_assignments set status = 'cancelled', cancelled_at = now()
        where occurrence_id = v_occ.id and user_id = v_uid and status = 'active';
      update public.lesson_applications set status = 'withdrawn', updated_at = now() where id = p_id;
      perform public.notify_staff('assignment_withdrawn', 'Odhlášení z lekce: ' || v_occ.title,
        v_name || ' · ' || public.fmt_local(v_occ.starts_at), '/lekce/' || v_occ.id);
      perform public.promote_waitlist(v_occ.id);
      return 'withdrawn';
    else
      update public.lesson_applications set status = 'cancel_requested', updated_at = now() where id = p_id;
      perform public.notify_staff('cancel_requested', 'Žádost o zrušení: ' || v_occ.title,
        v_name || ' · ' || public.fmt_local(v_occ.starts_at) || ' (méně než ' || v_hours || ' h předem)',
        '/prihlasky');
      return 'cancel_requested';
    end if;
  else
    raise exception 'Přihlášku ve stavu „%“ nelze zrušit.', v_app.status;
  end if;
end $$;

create or replace function public.resolve_cancel_request(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_app public.lesson_applications;
  v_occ public.lesson_occurrences;
begin
  select * into v_app from public.lesson_applications where id = p_id;
  if not found then raise exception 'Přihláška neexistuje.'; end if;
  select * into v_occ from public.lesson_occurrences where id = v_app.occurrence_id for update;
  select * into v_app from public.lesson_applications where id = p_id for update;
  if v_app.status <> 'cancel_requested' then raise exception 'Nejde o žádost o zrušení.'; end if;

  if p_approve then
    update public.instructor_assignments set status = 'cancelled', cancelled_at = now()
      where occurrence_id = v_occ.id and user_id = v_app.user_id and status = 'active';
    update public.lesson_applications set status = 'withdrawn', decided_by = v_uid, decided_at = now(),
      decision_note = p_note, updated_at = now() where id = p_id;
    perform public.notify(v_app.user_id, 'cancel_approved', 'Odhlášení schváleno: ' || v_occ.title,
      public.fmt_local(v_occ.starts_at), '/lekce/' || v_occ.id);
    perform public.promote_waitlist(v_occ.id);
  else
    update public.lesson_applications set status = 'approved', decision_note = p_note, updated_at = now()
      where id = p_id;
    perform public.notify(v_app.user_id, 'cancel_rejected', 'Odhlášení zamítnuto: ' || v_occ.title,
      'Lekce zůstává ve vašem rozvrhu.' || coalesce(' ' || p_note, ''), '/lekce/' || v_occ.id);
  end if;
end $$;

-- Přímé přiřazení instruktora (záskok, ruční plánování)
create or replace function public.assign_instructor(p_occurrence uuid, p_user uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_occ public.lesson_occurrences;
  v_app_id uuid;
  v_active int;
  v_assignment uuid;
begin
  select * into v_occ from public.lesson_occurrences where id = p_occurrence for update;
  if not found then raise exception 'Termín lekce neexistuje.'; end if;
  if v_occ.status = 'cancelled' then raise exception 'Lekce je zrušena.'; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then
    raise exception 'Instruktor neexistuje nebo je deaktivován.';
  end if;
  select count(*) into v_active from public.instructor_assignments
    where occurrence_id = p_occurrence and status = 'active';
  if v_active >= v_occ.required_instructors then
    raise exception 'Lekce je již plně obsazena. Nejprve navyšte kapacitu.' using hint = 'FULL';
  end if;

  insert into public.lesson_applications (occurrence_id, user_id, status, decided_by, decided_at, decision_note)
  values (p_occurrence, p_user, 'approved', v_uid, now(), 'Přiřazeno koordinátorem')
  on conflict (occurrence_id, user_id) do update
    set status = 'approved', decided_by = v_uid, decided_at = now(),
        decision_note = 'Přiřazeno koordinátorem', updated_at = now()
  returning id into v_app_id;

  v_assignment := public.insert_assignment(v_occ, p_user, v_app_id);

  perform public.notify(p_user, 'assigned', 'Přiřazení na lekci: ' || v_occ.title,
    public.fmt_local(v_occ.starts_at), '/lekce/' || v_occ.id);
  if v_active + 1 >= v_occ.required_instructors then
    update public.lesson_applications set status = 'waitlisted', updated_at = now()
      where occurrence_id = v_occ.id and status = 'pending';
  end if;
  return v_assignment;
end $$;

create or replace function public.remove_assignment(p_assignment uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_a public.instructor_assignments;
  v_occ public.lesson_occurrences;
begin
  select * into v_a from public.instructor_assignments where id = p_assignment;
  if not found or v_a.status <> 'active' then raise exception 'Přiřazení neexistuje.'; end if;
  select * into v_occ from public.lesson_occurrences where id = v_a.occurrence_id for update;
  if exists (select 1 from public.attendance_records where assignment_id = p_assignment) then
    raise exception 'K přiřazení už existuje potvrzená docházka – upravte ji ve výkazu.';
  end if;
  update public.instructor_assignments set status = 'cancelled', cancelled_at = now() where id = p_assignment;
  update public.lesson_applications set status = 'withdrawn', decided_by = v_uid, decided_at = now(),
    decision_note = coalesce(p_reason, 'Odebráno koordinátorem'), updated_at = now()
    where occurrence_id = v_a.occurrence_id and user_id = v_a.user_id;
  perform public.notify(v_a.user_id, 'assignment_removed', 'Odebrání z lekce: ' || v_occ.title,
    public.fmt_local(v_occ.starts_at) || coalesce(' · ' || p_reason, ''), '/lekce/' || v_occ.id);
  perform public.promote_waitlist(v_occ.id);
end $$;

-- ---------------------------------------------------------------------
-- Docházka a kredity
-- ---------------------------------------------------------------------
-- p_entries: [{ assignment_id, status: present|partial|absent, hours, note }]
create or replace function public.confirm_attendance(p_occurrence uuid, p_entries jsonb)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_occ public.lesson_occurrences;
  v_period date;
  e record;
  v_a public.instructor_assignments;
  v_status public.attendance_status;
  v_hours numeric;
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

  for e in
    select * from jsonb_to_recordset(p_entries) as x(assignment_id uuid, status text, hours numeric, note text)
  loop
    select * into v_a from public.instructor_assignments
      where id = e.assignment_id and occurrence_id = p_occurrence and status = 'active';
    if not found then raise exception 'Přiřazení % k této lekci neexistuje.', e.assignment_id; end if;

    v_status := coalesce(e.status, 'present')::public.attendance_status;
    v_hours := case when v_status = 'absent' then 0
                    else coalesce(e.hours, extract(epoch from (v_occ.ends_at - v_occ.starts_at)) / 3600.0) end;
    if v_hours < 0 or v_hours > 16 then raise exception 'Neplatný počet hodin: %', v_hours; end if;
    v_hours := round(v_hours, 2);
    v_credits := round(v_hours * v_occ.credit_multiplier, 2);

    insert into public.attendance_records (assignment_id, occurrence_id, user_id, lesson_type_id, period,
      status, hours, credit_multiplier, credits, note, confirmed_by)
    values (v_a.id, v_occ.id, v_a.user_id, v_occ.lesson_type_id, v_period,
      v_status, v_hours, v_occ.credit_multiplier, v_credits, e.note, v_uid)
    on conflict (assignment_id) do update set
      status = excluded.status, hours = excluded.hours, credit_multiplier = excluded.credit_multiplier,
      credits = excluded.credits, note = excluded.note, confirmed_by = excluded.confirmed_by,
      confirmed_at = now(), updated_at = now()
    returning id into v_att;

    -- kniha kreditů je append-only: oprava = korekční zápis s rozdílem
    select coalesce(sum(credits), 0), count(*) into v_existing, v_n
      from public.credit_ledger where attendance_id = v_att;
    v_delta := v_credits - v_existing;
    if v_delta <> 0 then
      insert into public.credit_ledger (user_id, period, kind, credits, lesson_type_id, attendance_id,
        description, created_by)
      values (v_a.user_id, v_period, case when v_n = 0 then 'lesson' else 'adjustment' end::public.ledger_kind,
        v_delta, v_occ.lesson_type_id, v_att,
        case when v_n = 0 then v_occ.title || ' · ' || v_hours || ' h × ' || v_occ.credit_multiplier
             else 'Oprava výkazu: ' || v_occ.title end,
        v_uid);
    end if;

    if v_n = 0 or v_delta <> 0 then
      perform public.notify(v_a.user_id, 'attendance_confirmed',
        case when v_n = 0 then 'Účast potvrzena: ' else 'Výkaz opraven: ' end || v_occ.title,
        v_hours || ' h · ' || v_credits || ' kreditů', '/vykazy');
    end if;
    v_count := v_count + 1;
  end loop;

  update public.lesson_occurrences set status = 'completed', registration_status = 'closed', updated_at = now()
    where id = p_occurrence;
  return v_count;
end $$;

create or replace function public.add_bonus(
  p_user uuid, p_reason public.bonus_reason, p_reason_text text, p_awarded_on date,
  p_credits numeric default 0, p_amount numeric default 0)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_period date := date_trunc('month', p_awarded_on)::date;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Instruktor neexistuje.';
  end if;
  if coalesce(p_credits, 0) < 0 or coalesce(p_amount, 0) < 0 then
    raise exception 'Bonus nemůže být záporný.';
  end if;
  perform public.ensure_period_open(v_period);

  insert into public.bonus_records (user_id, reason, reason_text, awarded_on, period, credits, amount, approved_by)
  values (p_user, p_reason, p_reason_text, p_awarded_on, v_period, coalesce(p_credits, 0), coalesce(p_amount, 0), v_uid)
  returning id into v_id;

  if coalesce(p_credits, 0) > 0 then
    insert into public.credit_ledger (user_id, period, kind, credits, bonus_id, description, created_by)
    values (p_user, v_period, 'bonus', p_credits, v_id, 'Bonus: ' || p_reason_text, v_uid);
  end if;

  perform public.notify(p_user, 'bonus', 'Získali jste bonus',
    concat_ws(' · ', p_reason_text,
      case when p_credits > 0 then p_credits || ' kreditů' end,
      case when p_amount > 0 then p_amount || ' Kč' end), '/vykazy');
  return v_id;
end $$;

create or replace function public.revoke_bonus(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_b public.bonus_records;
begin
  select * into v_b from public.bonus_records where id = p_id for update;
  if not found or v_b.revoked_at is not null then raise exception 'Bonus neexistuje nebo již byl zrušen.'; end if;
  perform public.ensure_period_open(v_b.period);
  update public.bonus_records set revoked_at = now(), revoked_by = v_uid, revoke_reason = p_reason where id = p_id;
  if v_b.credits > 0 then
    insert into public.credit_ledger (user_id, period, kind, credits, bonus_id, description, created_by)
    values (v_b.user_id, v_b.period, 'adjustment', -v_b.credits, v_b.id, 'Zrušení bonusu: ' || coalesce(p_reason, ''), v_uid);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Výkazy a odměny
-- ---------------------------------------------------------------------
create or replace function public._compute_statement(p_user uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month')::date;
  v_hours numeric; v_lessons int;
  v_lesson_credits numeric; v_bonus_credits numeric; v_other_credits numeric;
  v_bonus_amount numeric;
  rs public.reward_settings;
  v_base numeric := 0;
  v_by_type jsonb; v_items jsonb; v_bonuses jsonb;
begin
  select coalesce(sum(hours), 0), count(*) filter (where status <> 'absent')
    into v_hours, v_lessons
    from public.attendance_records where user_id = p_user and period = v_period;
  select coalesce(sum(credits) filter (where attendance_id is not null), 0),
         coalesce(sum(credits) filter (where bonus_id is not null), 0),
         coalesce(sum(credits) filter (where attendance_id is null and bonus_id is null), 0)
    into v_lesson_credits, v_bonus_credits, v_other_credits
    from public.credit_ledger where user_id = p_user and period = v_period;
  select coalesce(sum(amount), 0) into v_bonus_amount
    from public.bonus_records where user_id = p_user and period = v_period and revoked_at is null;

  select * into rs from public.reward_settings
    where user_id = p_user and valid_from < v_end order by valid_from desc limit 1;
  if found then
    v_base := case rs.model
      when 'credit' then round((v_lesson_credits + v_bonus_credits + v_other_credits) * rs.credit_rate, 2)
      when 'hourly' then round(v_hours * rs.hourly_rate, 2)
      when 'fixed' then rs.fixed_amount
    end;
  end if;

  select coalesce(jsonb_agg(t order by t.sort_order), '[]') into v_by_type from (
    select lt.id as lesson_type_id, lt.name, lt.color, lt.sort_order,
      sum(ar.hours) as hours, sum(ar.credits) as credits,
      count(*) filter (where ar.status <> 'absent') as lessons
    from public.attendance_records ar join public.lesson_types lt on lt.id = ar.lesson_type_id
    where ar.user_id = p_user and ar.period = v_period
    group by lt.id, lt.name, lt.color, lt.sort_order
  ) t;

  select coalesce(jsonb_agg(i order by i.starts_at), '[]') into v_items from (
    select ar.id, o.id as occurrence_id, o.title, o.starts_at, o.ends_at, lt.name as lesson_type,
      l.name as location, ar.status, ar.hours, ar.credit_multiplier, ar.credits
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
    'lesson_credits', v_lesson_credits + v_other_credits,
    'bonus_credits', v_bonus_credits,
    'total_credits', v_lesson_credits + v_bonus_credits + v_other_credits,
    'bonus_amount', v_bonus_amount,
    'model', rs.model,
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

-- výkaz ze snímku (uzavřený měsíc) nebo živý výpočet
create or replace function public._statement(p_user uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_snap jsonb;
begin
  select snapshot -> p_user::text into v_snap from public.report_periods
    where period = date_trunc('month', p_period)::date and status = 'closed';
  if v_snap is not null then
    return v_snap || jsonb_build_object('closed', true);
  end if;
  return public._compute_statement(p_user, p_period) ||
    jsonb_build_object('closed', exists (select 1 from public.report_periods
      where period = date_trunc('month', p_period)::date and status = 'closed'));
end $$;

-- Finanční výkaz: jen vlastník a admin (koordinátor ne)
create or replace function public.monthly_statement(p_user uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_active();
  if p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'K výkazu jiného instruktora nemáte přístup.' using errcode = '42501';
  end if;
  return public._statement(p_user, p_period);
end $$;

create or replace function public.team_overview(
  p_period date, p_lesson_type uuid default null, p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_admin boolean := public.is_admin();
  v_period date := date_trunc('month', p_period)::date;
  v_result jsonb;
begin
  perform public.require_staff();
  select coalesce(jsonb_agg(r order by r.last_name, r.first_name), '[]') into v_result from (
    select p.id as user_id, p.first_name, p.last_name, p.avatar_url, p.is_active,
      coalesce(st.hours, 0) as hours,
      coalesce(st.lessons, 0) as lessons,
      coalesce(st.credits, 0) as lesson_credits,
      case when p_lesson_type is null and p_location is null then coalesce(bc.credits, 0) else 0 end as bonus_credits,
      (select count(*) from public.instructor_assignments a
         join public.lesson_occurrences o on o.id = a.occurrence_id
        where a.user_id = p.id and a.status = 'active' and o.status <> 'cancelled'
          and public.period_of(o.starts_at) = v_period
          and (p_lesson_type is null or o.lesson_type_id = p_lesson_type)
          and (p_location is null or o.location_id = p_location)) as confirmed_lessons,
      case when v_admin and p_lesson_type is null and p_location is null
        then (public._statement(p.id, v_period) ->> 'total_amount')::numeric end as reward,
      case when v_admin then (select model from public.reward_settings rs where rs.user_id = p.id
        and rs.valid_from < (v_period + interval '1 month')::date order by valid_from desc limit 1) end as model
    from public.profiles p
    left join lateral (
      select sum(ar.hours) as hours, count(*) filter (where ar.status <> 'absent') as lessons,
             sum(ar.credits) as credits
      from public.attendance_records ar join public.lesson_occurrences o on o.id = ar.occurrence_id
      where ar.user_id = p.id and ar.period = v_period
        and (p_lesson_type is null or ar.lesson_type_id = p_lesson_type)
        and (p_location is null or o.location_id = p_location)
    ) st on true
    left join lateral (
      select sum(credits) as credits from public.credit_ledger
      where user_id = p.id and period = v_period and bonus_id is not null
    ) bc on true
    where exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'instructor')
      and (p.is_active or st.hours is not null)
  ) r;
  return v_result;
end $$;

create or replace function public.period_status(p_period date)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select status::text from public.report_periods
                   where period = date_trunc('month', p_period)::date), 'open');
$$;

create or replace function public.close_period(p_period date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  v_period date := date_trunc('month', p_period)::date;
  v_snapshot jsonb;
begin
  if public.period_status(v_period) = 'closed' then raise exception 'Měsíc je již uzavřen.'; end if;
  if v_period >= date_trunc('month', now() at time zone 'Europe/Prague')::date then
    raise exception 'Uzavřít lze pouze měsíc, který již skončil.';
  end if;
  if exists (select 1 from public.lesson_occurrences o
             where public.period_of(o.starts_at) = v_period and o.status = 'scheduled'
               and exists (select 1 from public.instructor_assignments a where a.occurrence_id = o.id and a.status = 'active')) then
    raise exception 'V měsíci jsou obsazené lekce bez potvrzené docházky. Nejprve je vykažte nebo zrušte.'
      using hint = 'UNCONFIRMED';
  end if;

  select coalesce(jsonb_object_agg(u.id::text, public._compute_statement(u.id, v_period)), '{}')
    into v_snapshot
  from (
    select id from public.profiles p
    where exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'instructor')
       or exists (select 1 from public.attendance_records ar where ar.user_id = p.id and ar.period = v_period)
       or exists (select 1 from public.bonus_records b where b.user_id = p.id and b.period = v_period)
  ) u;

  insert into public.report_periods (period, status, closed_at, closed_by, snapshot)
  values (v_period, 'closed', now(), v_uid, v_snapshot)
  on conflict (period) do update set status = 'closed', closed_at = now(), closed_by = v_uid,
    snapshot = excluded.snapshot;
  return (select count(*) from jsonb_object_keys(v_snapshot));
end $$;

create or replace function public.reopen_period(p_period date, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.require_admin();
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Uveďte důvod znovuotevření.'; end if;
  update public.report_periods set status = 'open', snapshot = null, reopened_at = now(),
    reopened_by = v_uid, reopen_reason = p_reason
  where period = date_trunc('month', p_period)::date and status = 'closed';
  if not found then raise exception 'Měsíc není uzavřen.'; end if;
end $$;

create or replace function public.my_credit_history(p_months int default 6)
returns table (period date, lesson_credits numeric, bonus_credits numeric, hours numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.period::date,
    coalesce((select sum(credits) from public.credit_ledger l
              where l.user_id = auth.uid() and l.period = m.period and l.bonus_id is null), 0),
    coalesce((select sum(credits) from public.credit_ledger l
              where l.user_id = auth.uid() and l.period = m.period and l.bonus_id is not null), 0),
    coalesce((select sum(ar.hours) from public.attendance_records ar
              where ar.user_id = auth.uid() and ar.period = m.period), 0)
  from generate_series(
    date_trunc('month', now() at time zone 'Europe/Prague') - make_interval(months => greatest(p_months, 1) - 1),
    date_trunc('month', now() at time zone 'Europe/Prague'),
    interval '1 month') as m(period)
  where public.current_user_active()
  order by 1;
$$;

-- ---------------------------------------------------------------------
-- Dashboard správce a návrhy instruktorů
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Europe/Prague')::date);
  v_period date := date_trunc('month', v_day)::date;
  v_admin boolean := public.is_admin();
  v_out jsonb;
begin
  perform public.require_staff();
  with occ as (
    select o.*, lt.name as type_name, lt.color as type_color, l.name as location_name,
      (select count(*) from public.instructor_assignments a where a.occurrence_id = o.id and a.status = 'active') as assigned,
      (select count(*) from public.lesson_applications ap where ap.occurrence_id = o.id and ap.status = 'pending') as pending
    from public.lesson_occurrences o
    join public.lesson_types lt on lt.id = o.lesson_type_id
    join public.locations l on l.id = o.location_id
    where o.starts_at >= (v_day - 1)::timestamp at time zone 'Europe/Prague'
      and o.starts_at < (v_day + 31)::timestamp at time zone 'Europe/Prague'
  )
  select jsonb_build_object(
    'day', v_day,
    'period', v_period,
    'today', coalesce((select jsonb_agg(to_jsonb(o) order by o.starts_at) from occ o
       where (o.starts_at at time zone 'Europe/Prague')::date = v_day and o.status <> 'cancelled'), '[]'),
    'understaffed', coalesce((select jsonb_agg(to_jsonb(o) order by o.starts_at) from (
       select * from occ where status = 'scheduled' and starts_at > now()
         and starts_at < now() + interval '14 days' and assigned < required_instructors
       order by starts_at limit 25) o), '[]'),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(o) order by o.starts_at) from (
       select * from occ where status = 'scheduled' and starts_at > now() order by starts_at limit 8) o), '[]'),
    'active_instructors', (select count(*) from public.profiles p where p.is_active and exists
       (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'instructor')),
    'pending_applications', (select count(*) from public.lesson_applications ap
       join public.lesson_occurrences o on o.id = ap.occurrence_id
       where ap.status in ('pending', 'cancel_requested') and o.status = 'scheduled'),
    'month_hours', (select coalesce(sum(hours), 0) from public.attendance_records where period = v_period),
    'month_credits', (select coalesce(sum(credits), 0) from public.credit_ledger where period = v_period),
    'estimated_cost', case when v_admin then (
       select coalesce(sum((public._statement(p.id, v_period) ->> 'total_amount')::numeric), 0)
       from public.profiles p where exists
         (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'instructor')) end,
    'unconfirmed', coalesce((select jsonb_agg(to_jsonb(o) order by o.starts_at) from (
       select o.id, o.title, o.starts_at, o.ends_at from public.lesson_occurrences o
       where o.status = 'scheduled' and o.ends_at < now()
         and exists (select 1 from public.instructor_assignments a where a.occurrence_id = o.id and a.status = 'active')
       order by o.starts_at limit 20) o), '[]'),
    'conflicts', coalesce((select jsonb_agg(c order by c.starts_at) from (
       -- přiřazený instruktor si označil, že nemůže pracovat
       select 'unavailable' as kind, o.id as occurrence_id, o.title, o.starts_at, p.id as user_id,
              trim(p.first_name || ' ' || p.last_name) as user_name
       from public.instructor_assignments a
       join public.lesson_occurrences o on o.id = a.occurrence_id
       join public.profiles p on p.id = a.user_id
       where a.status = 'active' and o.status = 'scheduled' and o.starts_at > now()
         and o.starts_at < now() + interval '30 days'
         and exists (select 1 from public.availability av where av.user_id = a.user_id and av.kind = 'unavailable'
           and (av.date = (o.starts_at at time zone 'Europe/Prague')::date
                or (av.date is null and av.weekday = extract(isodow from o.starts_at at time zone 'Europe/Prague')))
           and (av.start_time is null or (av.start_time < (o.ends_at at time zone 'Europe/Prague')::time
                                          and av.end_time > (o.starts_at at time zone 'Europe/Prague')::time)))
       union all
       -- čekající přihláška koliduje s již potvrzenou lekcí
       select 'overlap', o.id, o.title, o.starts_at, p.id, trim(p.first_name || ' ' || p.last_name)
       from public.lesson_applications ap
       join public.lesson_occurrences o on o.id = ap.occurrence_id
       join public.profiles p on p.id = ap.user_id
       where ap.status in ('pending', 'waitlisted') and o.status = 'scheduled' and o.starts_at > now()
         and exists (select 1 from public.instructor_assignments a2 where a2.user_id = ap.user_id
           and a2.status = 'active' and a2.during && tstzrange(o.starts_at, o.ends_at))
       union all
       select 'cancel_request', o.id, o.title, o.starts_at, p.id, trim(p.first_name || ' ' || p.last_name)
       from public.lesson_applications ap
       join public.lesson_occurrences o on o.id = ap.occurrence_id
       join public.profiles p on p.id = ap.user_id
       where ap.status = 'cancel_requested' and o.status = 'scheduled'
    ) c), '[]')
  ) into v_out;
  return v_out;
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
      (case x.availability when 'preferred' then 3 when 'available' then 2 when 'unavailable' then -5 else 0 end)
      + (case when x.specialization_match then 2 else 0 end)
      + (case when x.application_status in ('pending', 'waitlisted') then 2 else 0 end)
      + (case when x.preferred_location then 1 else 0 end)
      - (case when x.has_conflict then 20 else 0 end)
      - least(x.month_hours / 20.0, 3) as score
    from (
      select p.id as user_id, trim(p.first_name || ' ' || p.last_name) as name, p.avatar_url,
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

-- ---------------------------------------------------------------------
-- Oznámení a notifikace
-- ---------------------------------------------------------------------
create or replace function public.send_announcement(
  p_title text, p_body text, p_important boolean default false, p_recipients uuid[] default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_staff();
  v_id uuid;
begin
  insert into public.announcements (title, body, important, audience, created_by)
  values (p_title, p_body, coalesce(p_important, false),
          case when p_recipients is null then 'all' else 'selected' end, v_uid)
  returning id into v_id;

  insert into public.announcement_recipients (announcement_id, user_id)
  select v_id, p.id from public.profiles p
  where p.is_active and (p_recipients is null or p.id = any (p_recipients));

  insert into public.notifications (user_id, type, title, body, link)
  select r.user_id, 'announcement',
    case when p_important then 'Důležité: ' else '' end || p_title,
    left(p_body, 280), '/oznameni'
  from public.announcement_recipients r where r.announcement_id = v_id and r.user_id <> v_uid;
  return v_id;
end $$;

create or replace function public.mark_announcement(p_id uuid, p_acknowledge boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_active();
  update public.announcement_recipients set
    read_at = coalesce(read_at, now()),
    acknowledged_at = case when p_acknowledge then coalesce(acknowledged_at, now()) else acknowledged_at end
  where announcement_id = p_id and user_id = auth.uid();
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Správa uživatelů (doplňuje server actions se service role klíčem)
-- ---------------------------------------------------------------------
create or replace function public.set_user_roles(p_user uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  if p_user = auth.uid() and not ('admin' = any (p_roles)) then
    raise exception 'Nemůžete odebrat roli správce sami sobě.';
  end if;
  if coalesce(array_length(p_roles, 1), 0) = 0 then raise exception 'Uživatel musí mít alespoň jednu roli.'; end if;
  delete from public.user_roles where user_id = p_user and not (role = any (p_roles));
  insert into public.user_roles (user_id, role) select p_user, r from unnest(p_roles) r on conflict do nothing;
end $$;

create or replace function public.set_user_active(p_user uuid, p_active boolean)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.require_admin();
  r record;
  v_n int := 0;
begin
  if p_user = v_uid then raise exception 'Nemůžete deaktivovat vlastní účet.'; end if;
  update public.profiles set is_active = p_active, updated_at = now() where id = p_user;
  if not found then raise exception 'Uživatel neexistuje.'; end if;
  if not p_active then
    update public.lesson_applications set status = 'withdrawn', decision_note = 'Účet deaktivován', updated_at = now()
      where user_id = p_user and status in ('pending', 'waitlisted', 'cancel_requested');
    for r in
      select ia.id, ia.occurrence_id from public.instructor_assignments ia
      join public.lesson_occurrences o on o.id = ia.occurrence_id
      where ia.user_id = p_user and ia.status = 'active' and o.starts_at > now()
    loop
      update public.instructor_assignments set status = 'cancelled', cancelled_at = now() where id = r.id;
      update public.lesson_applications set status = 'withdrawn', decision_note = 'Účet deaktivován', updated_at = now()
        where occurrence_id = r.occurrence_id and user_id = p_user;
      perform public.promote_waitlist(r.occurrence_id);
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;   -- počet uvolněných budoucích lekcí
end $$;
