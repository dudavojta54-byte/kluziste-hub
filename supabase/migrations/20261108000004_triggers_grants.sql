-- =====================================================================
-- Triggery (synchronizace časů, zámky měsíců, audit, e-mailová fronta),
-- oprávnění k funkcím, realtime a storage
-- =====================================================================

-- Při změně času termínu přepočítat intervaly aktivních obsazení.
-- Pokud by vznikl konflikt, EXCLUDE constraint celou změnu odmítne.
create or replace function public.sync_assignment_ranges()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
    begin
      update public.instructor_assignments set during = tstzrange(new.starts_at, new.ends_at)
        where occurrence_id = new.id and status = 'active';
    exception when exclusion_violation then
      raise exception 'Změna času by způsobila časový konflikt u přiřazeného instruktora (%).',
        public.fmt_local(new.starts_at) using hint = 'CONFLICT';
    end;
  end if;
  return new;
end $$;

create trigger lesson_occurrences_sync_ranges after update of starts_at, ends_at on public.lesson_occurrences
  for each row execute function public.sync_assignment_ranges();

-- Zámek uzavřeného měsíce pro docházku, kredity a bonusy
create or replace function public.enforce_open_period()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.ensure_period_open(old.period); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.ensure_period_open(new.period); end if;
  return coalesce(new, old);
end $$;

create trigger attendance_period_lock before insert or update or delete on public.attendance_records
  for each row execute function public.enforce_open_period();
create trigger bonus_period_lock before insert or update or delete on public.bonus_records
  for each row execute function public.enforce_open_period();
create trigger ledger_period_lock before insert on public.credit_ledger
  for each row execute function public.enforce_open_period();

-- Kniha kreditů je pouze pro přidávání
create or replace function public.ledger_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Záznamy v knize kreditů nelze měnit ani mazat – použijte korekční zápis.';
end $$;

create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function public.ledger_append_only();

-- ---------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  -- snímky výkazů jsou velké; v auditu stačí stav
  if tg_table_name = 'report_periods' then
    v_old := v_old - 'snapshot';
    v_new := v_new - 'snapshot';
  end if;
  insert into public.audit_logs (table_name, record_id, action, actor, old_data, new_data)
  values (tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id',
             v_new ->> 'period', v_old ->> 'period'),
    tg_op, auth.uid(), v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'profile_private', 'user_roles', 'lessons', 'lesson_occurrences', 'lesson_applications',
    'instructor_assignments', 'attendance_records', 'credit_ledger', 'bonus_records',
    'reward_settings', 'report_periods', 'locations', 'lesson_types', 'app_settings', 'contacts', 'documents'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- E-mailová fronta: každá notifikace => e-mail (pokud to uživatel nevypnul)
-- ---------------------------------------------------------------------
create or replace function public.queue_notification_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  select u.email into v_email
  from auth.users u join public.profiles p on p.id = u.id
  where u.id = new.user_id and p.is_active and p.notify_email;
  if v_email is not null then
    insert into public.email_outbox (notification_id, to_email, subject, body)
    values (new.id, v_email, new.title, coalesce(new.body, '') ||
      case when new.link is not null then E'\n\n' || new.link else '' end);
  end if;
  return new;
end $$;

create trigger notifications_queue_email after insert on public.notifications
  for each row execute function public.queue_notification_email();

-- ---------------------------------------------------------------------
-- Oprávnění: anon nemá přístup k ničemu; interní funkce nejsou volatelné
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

revoke execute on function
  public._compute_statement(uuid, date),
  public._statement(uuid, date),
  public.notify(uuid, text, text, text, text),
  public.notify_staff(text, text, text, text),
  public.promote_waitlist(uuid),
  public.insert_assignment(public.lesson_occurrences, uuid, uuid),
  public.ensure_period_open(date),
  public.handle_new_user(),
  public.protect_profile_columns(),
  public.sync_assignment_ranges(),
  public.enforce_open_period(),
  public.ledger_append_only(),
  public.audit_trigger(),
  public.queue_notification_email()
from authenticated;

-- service role (server, cron) – plný přístup
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
-- Realtime (jen na Supabase) – RLS platí i pro realtime události
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.lesson_occurrences, public.lesson_applications, public.instructor_assignments,
      public.notifications, public.announcements, public.attendance_records, public.credit_ledger;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Storage: profilové fotky (veřejné čtení) a provozní dokumenty (jen tým)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict do nothing;
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict do nothing;

    execute $p$create policy "avatars_own_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "avatars_own_update" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "avatars_own_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy "documents_team_read" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and public.current_user_active())$p$;
    execute $p$create policy "documents_admin_write" on storage.objects for all to authenticated
      using (bucket_id = 'documents' and public.is_admin())
      with check (bucket_id = 'documents' and public.is_admin())$p$;
  end if;
end $$;
