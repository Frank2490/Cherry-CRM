-- Po migracji. Potrzebne są DWA JUŻ ISTNIEJĄCE, różne konta.
-- Nie twórz kont tylko po to, aby uruchomić ten plik bez osobnej zgody.
-- Uruchom CAŁOŚĆ jako administrator mogący wykonać SET ROLE.
-- Kontrole danych wykonujemy jako authenticated/anon, nigdy jako administrator.
begin;
select set_config('crm_test.user_a', '', true);
select set_config('crm_test.user_b', '', true);
select set_config('crm_test.lead_a', gen_random_uuid()::text, true);
select set_config('crm_test.lead_b', gen_random_uuid()::text, true);

do $setup$
declare
  a uuid := nullif(current_setting('crm_test.user_a'), '')::uuid;
  b uuid := nullif(current_setting('crm_test.user_b'), '')::uuid;
begin
  if a is null or b is null or a = b
    or not exists (select 1 from auth.users where id = a)
    or not exists (select 1 from auth.users where id = b) then
    raise exception 'Wstaw UUID dwóch różnych, istniejących kont A i B. Nie utworzono użytkowników.';
  end if;
  if exists (select 1 from pg_roles where rolname in ('authenticated', 'anon') and (rolsuper or rolbypassrls)) then
    raise exception 'Role testowe nie mogą być superuser ani BYPASSRLS.';
  end if;
  if exists (
    select 1 from pg_class
    where oid in ('public.leads'::regclass, 'public.lead_activities'::regclass)
      and not relrowsecurity
  ) then raise exception 'RLS musi być włączone na obu tabelach.'; end if;
end;
$setup$;

select set_config('request.jwt.claim.sub', current_setting('crm_test.user_a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_a'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $owner_a$
declare
  a uuid := current_setting('crm_test.user_a')::uuid;
  b uuid := current_setting('crm_test.user_b')::uuid;
  test_lead_id uuid := current_setting('crm_test.lead_a')::uuid;
  actual_owner uuid;
  affected bigint;
  test_case record;
  observed_state text;
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from a then
    raise exception 'Test A nie wykonuje się jako authenticated z UID A.';
  end if;
  if exists (
    select 1 from pg_class
    where oid in ('public.leads'::regclass, 'public.lead_activities'::regclass)
      and pg_has_role(current_user, relowner, 'USAGE')
  ) then raise exception 'Rola testowa nie może być właścicielem tabel ani dziedziczyć jego uprawnień.'; end if;

  insert into public.leads(id, company_name, phone, follow_up_date)
  values (test_lead_id, '__crm_rls_test_A__', '__test__', current_date)
  returning user_id into actual_owner;
  if actual_owner is distinct from a then raise exception 'Domyślny właściciel nie jest A.'; end if;
  if not exists (select 1 from public.leads where id = test_lead_id) then
    raise exception 'A nie odczytuje własnego leada.';
  end if;
  update public.leads set next_step = '__owner_A__' where id = test_lead_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A nie aktualizuje własnego leada.'; end if;

  insert into public.lead_activities(lead_id, type, content) values (test_lead_id, 'note', '__note_A__');
  insert into public.lead_activities(lead_id, type, content, occurred_at) values (test_lead_id, 'contact', '__contact_A__', now());
  if (select count(*) from public.lead_activities la where la.lead_id = test_lead_id) <> 2 then
    raise exception 'A nie odczytuje własnych aktywności.';
  end if;
  if (select last_contact_at from public.leads where id = test_lead_id) is distinct from now() then
    raise exception 'Trigger kontaktu nie działa z uprawnieniami authenticated.';
  end if;

  for test_case in select * from (values
    ('przepisanie właściciela', format('update public.leads set user_id = %L where id = %L', b, test_lead_id)),
    ('insert z cudzym właścicielem', format($$insert into public.leads(user_id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, b)),
    ('DELETE leads', format('delete from public.leads where id = %L', test_lead_id)),
    ('UPDATE activities', format($$update public.lead_activities set content = '__forbidden__' where lead_id = %L$$, test_lead_id)),
    ('DELETE activities', format('delete from public.lead_activities where lead_id = %L', test_lead_id))
  ) as cases(label, statement) loop
    observed_state := null;
    begin execute test_case.statement;
    exception when others then observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'FAIL %: oczekiwano 42501, otrzymano %', test_case.label, observed_state;
    end if;
  end loop;
  raise notice 'PASS A: własne leady i historia dostępne; zmiana właściciela, DELETE oraz edycja historii zabronione.';
end;
$owner_a$;

select set_config('request.jwt.claim.sub', current_setting('crm_test.user_b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_b'), 'role', 'authenticated')::text, true);

do $owner_b$
declare
  a uuid := current_setting('crm_test.user_a')::uuid;
  b uuid := current_setting('crm_test.user_b')::uuid;
  a_lead uuid := current_setting('crm_test.lead_a')::uuid;
  b_lead uuid := current_setting('crm_test.lead_b')::uuid;
  affected bigint;
  statement text;
  observed_state text;
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from b then
    raise exception 'Test B nie wykonuje się jako authenticated z UID B.';
  end if;
  if exists (select 1 from public.leads where id = a_lead)
    or exists (select 1 from public.lead_activities where lead_id = a_lead) then
    raise exception 'B odczytuje dane A.';
  end if;
  update public.leads set next_step = '__forbidden_B__' where id = a_lead;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'B zmodyfikował leada A.'; end if;
  update public.leads set user_id = b where id = a_lead;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'B przejął leada A.'; end if;

  foreach statement in array array[
    format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'contact', '__forbidden_B__')$$, a_lead),
    format($$insert into public.leads(user_id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, a)
  ] loop
    observed_state := null;
    begin execute statement;
    exception when others then observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'B zapisuje dane A lub otrzymuje nieoczekiwany błąd: %', observed_state;
    end if;
  end loop;
  insert into public.leads(id, company_name, phone, follow_up_date)
  values (b_lead, '__crm_rls_test_B__', '__test__', current_date);
  if not exists (select 1 from public.leads where id = b_lead and user_id = b) then
    raise exception 'B nie ma dostępu do własnego leada.';
  end if;
  raise notice 'PASS B: dane A niewidoczne; UPDATE A zmienia 0 wierszy; cudze inserty odrzucone.';
end;
$owner_b$;

select set_config('request.jwt.claim.sub', current_setting('crm_test.user_a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_a'), 'role', 'authenticated')::text, true);
do $unchanged$
begin
  if not exists (
    select 1 from public.leads
    where id = current_setting('crm_test.lead_a')::uuid
      and user_id = auth.uid() and next_step = '__owner_A__' and last_contact_at = now()
  ) or (select count(*) from public.lead_activities where lead_id = current_setting('crm_test.lead_a')::uuid) <> 2 then
    raise exception 'Dane A uległy zmianie po próbach B.';
  end if;
  if exists (select 1 from public.leads where id = current_setting('crm_test.lead_b')::uuid) then
    raise exception 'A odczytuje dane B.';
  end if;
end;
$unchanged$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $anonymous$
declare
  lead_id uuid := current_setting('crm_test.lead_a')::uuid;
  owner_id uuid := current_setting('crm_test.user_a')::uuid;
  statement text;
  observed_state text;
begin
  if current_user <> 'anon' or auth.uid() is not null then
    raise exception 'Test anonimowy nie wykonuje się jako anon bez UID.';
  end if;
  foreach statement in array array[
    format('select * from public.leads where id = %L', lead_id),
    format('select * from public.lead_activities where lead_id = %L', lead_id),
    format($$insert into public.leads(user_id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, owner_id),
    format($$update public.leads set next_step = '__forbidden_anon__' where id = %L$$, lead_id),
    format('delete from public.leads where id = %L', lead_id),
    format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', '__test__')$$, lead_id),
    format($$update public.lead_activities set content = '__forbidden_anon__' where lead_id = %L$$, lead_id),
    format('delete from public.lead_activities where lead_id = %L', lead_id)
  ] loop
    observed_state := null;
    begin execute statement;
    exception when others then observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'Anon ma dostęp lub otrzymuje nieoczekiwany błąd: %', observed_state;
    end if;
  end loop;
  raise notice 'PASS anon: odczyt i modyfikacje obu tabel zabronione.';
end;
$anonymous$;

reset role;
rollback;
