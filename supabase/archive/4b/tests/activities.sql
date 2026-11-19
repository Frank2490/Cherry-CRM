-- Tylko lokalna/testowa baza po migracji 4B. Nie uruchamiaj na produkcji.
-- Wpisz UUID jednego ISTNIEJĄCEGO użytkownika Auth i wykonaj CAŁY plik.
-- Kontrole działają jako authenticated; wszystkie dane wycofuje ROLLBACK.
begin;
select set_config('crm_activity_test.user_a', '', true);

do $setup$
declare
  owner_id uuid := nullif(current_setting('crm_activity_test.user_a'), '')::uuid;
begin
  if owner_id is null or not exists (
    select 1 from auth.users where id = owner_id
  ) then raise exception 'Wpisz UUID istniejącego użytkownika w crm_activity_test.user_a.'; end if;
end;
$setup$;

select set_config('request.jwt.claim.sub', current_setting('crm_activity_test.user_a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_activity_test.user_a'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $test$
declare
  lead_uuid uuid;
  contact_uuid uuid := gen_random_uuid();
  old_contact timestamptz := now() - interval '2 days';
  new_contact timestamptz := now();
  change_content jsonb;
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from current_setting('crm_activity_test.user_a')::uuid
    or exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))
    or exists (select 1 from pg_class where oid in ('public.leads'::regclass, 'public.lead_activities'::regclass)
      and pg_has_role(current_user, relowner, 'USAGE')) then
    raise exception 'Test wymaga roli authenticated z UID A, bez omijania RLS i bez własności tabel.';
  end if;

  insert into public.leads(company_name, phone)
  values ('__crm_activities_test__', '__test__') returning id into lead_uuid;
  if exists (select 1 from public.lead_activities where lead_id = lead_uuid) then
    raise exception 'Utworzenie leada nie powinno rejestrować zmiany statusu.';
  end if;

  update public.leads set status = 'new', next_step = '__test__' where id = lead_uuid;
  if exists (select 1 from public.lead_activities where lead_id = lead_uuid) then
    raise exception 'Zapis niezmienionego statusu tworzy zbędny wpis.';
  end if;

  update public.leads set status = 'interested' where id = lead_uuid;
  if (select count(*) from public.lead_activities where lead_id = lead_uuid and type = 'status_change') <> 1 then
    raise exception 'Zmiana statusu nie tworzy dokładnie jednego wpisu.';
  end if;
  select content::jsonb into change_content from public.lead_activities where lead_id = lead_uuid and type = 'status_change';
  if change_content is distinct from jsonb_build_object('from_status', 'new', 'to_status', 'interested') then
    raise exception 'Nieprawidłowe stare/nowe statusy w treści zdarzenia.';
  end if;
  update public.leads set status = 'interested' where id = lead_uuid;
  if (select count(*) from public.lead_activities where lead_id = lead_uuid) <> 1 then
    raise exception 'Powtórzony zapis statusu tworzy duplikat.';
  end if;

  begin
    update public.leads set status = 'proposal', company_name = '' where id = lead_uuid;
    raise exception 'Niepoprawna nazwa została zaakceptowana.';
  exception when check_violation then null;
  end;
  if (select status from public.leads where id = lead_uuid) <> 'interested'
    or (select count(*) from public.lead_activities where lead_id = lead_uuid) <> 1 then
    raise exception 'Nieudany UPDATE zmienił status lub historię.';
  end if;

  insert into public.lead_activities(lead_id, type, content) values (lead_uuid, 'note', '__note__');
  if (select last_contact_at from public.leads where id = lead_uuid) is not null then
    raise exception 'Notatka lub zmiana statusu aktualizuje last_contact_at.';
  end if;
  insert into public.lead_activities(lead_id, type, content, channel, occurred_at)
    values (lead_uuid, 'contact', '__old_contact__', 'instagram', old_contact);
  insert into public.lead_activities(id, lead_id, type, content, channel, occurred_at)
    values (contact_uuid, lead_uuid, 'contact', '__contact__', 'email', new_contact);
  if (select last_contact_at from public.leads where id = lead_uuid) is distinct from new_contact then
    raise exception 'Kontakt nie aktualizuje last_contact_at.';
  end if;
  insert into public.lead_activities(lead_id, type, content, channel, occurred_at)
    values (lead_uuid, 'contact', '__older_contact__', 'phone', old_contact);
  if (select last_contact_at from public.leads where id = lead_uuid) is distinct from new_contact then
    raise exception 'Starszy kontakt cofa last_contact_at.';
  end if;

  begin
    insert into public.lead_activities(id, lead_id, type, content, channel, occurred_at)
      values (contact_uuid, lead_uuid, 'contact', '__contact__', 'email', new_contact);
    raise exception 'Powtórzony UUID nie został odrzucony przez PK.';
  exception when unique_violation then null;
  end;
  if (select count(*) from public.lead_activities where lead_id = lead_uuid and type = 'contact') <> 3
    or (select count(*) from public.lead_activities where lead_id = lead_uuid and type = 'status_change') <> 1 then
    raise exception 'Kontakt lub jego ponowienie utworzyło dodatkowy wpis.';
  end if;
  update public.leads set status = 'won', follow_up_date = null where id = lead_uuid;
  if (select count(*) from public.lead_activities where lead_id = lead_uuid and type = 'status_change') <> 2 then
    raise exception 'Druga rzeczywista zmiana statusu nie tworzy jednego zdarzenia.';
  end if;
end;
$test$;

select 'PASS: historia statusów, brak duplikatów i trigger kontaktu działają jako authenticated' as result;
rollback;
