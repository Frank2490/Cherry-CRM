-- Test RLS z JEDNYM istniejącym kontem Supabase Auth, po wszystkich migracjach.
-- W pierwszym set_config wpisz UUID swojego konta A zamiast pustego tekstu.
-- B to wygenerowany UUID NIEISTNIEJĄCY w auth.users, bez tworzenia konta.
-- Nie tworzymy leada B. Symulacja claims nie jest testem logowania/JWT B.
-- Uruchom CAŁY plik w SQL Editor jako administrator mogący wykonać SET ROLE.
-- Administrator sprawdza tylko warunki wstępne; dane testujemy jako role API.
-- Po błędzie uruchom ROLLBACK; nie uruchamiaj samego końcowego SELECT.
begin;
select set_config('crm_test.user_a', 'f3a6640b-1da4-49cc-bee9-aaffcaea295e', true); -- TUTAJ WPISZ UUID KONTA A.
select set_config('crm_test.lead_a', gen_random_uuid()::text, true);
select set_config('crm_test.won_lead', gen_random_uuid()::text, true);
select set_config('crm_test.lost_lead', gen_random_uuid()::text, true);

do $setup$
declare
  a uuid;
  b uuid;
begin
  begin
    a := nullif(btrim(current_setting('crm_test.user_a')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'FAIL setup: crm_test.user_a musi zawierać poprawny UUID istniejącego konta A.';
  end;
  if a is null or not exists (select 1 from auth.users where id = a) then
    raise exception 'FAIL setup: wpisz UUID istniejącego konta A w pierwszym set_config.';
  end if;
  perform set_config('crm_test.user_a', a::text, true);

  loop
    b := gen_random_uuid();
    exit when b <> a and not exists (select 1 from auth.users where id = b);
  end loop;
  perform set_config('crm_test.user_b', b::text, true);

  if (select count(*) from pg_roles where rolname in ('authenticated', 'anon')) <> 2
    or exists (
      select 1 from pg_roles
      where rolname in ('authenticated', 'anon') and (rolsuper or rolbypassrls)
    ) then
    raise exception 'FAIL setup: wymagane są role authenticated i anon bez SUPERUSER/BYPASSRLS.';
  end if;
  if exists (
    select 1 from pg_class
    where oid in ('public.leads'::regclass, 'public.lead_activities'::regclass)
      and not relrowsecurity
  ) then
    raise exception 'FAIL setup: RLS musi być włączone na obu tabelach.';
  end if;
  if exists (
    select 1 from pg_class c
    cross join (values ('authenticated'::name), ('anon'::name)) as roles(role_name)
    where c.oid in ('public.leads'::regclass, 'public.lead_activities'::regclass)
      and pg_has_role(roles.role_name, c.relowner, 'USAGE')
  ) then
    raise exception 'FAIL setup: role API nie mogą być właścicielami tabel ani dziedziczyć ich uprawnień.';
  end if;
end;
$setup$;

-- A: rzeczywisty użytkownik, operacje z uprawnieniami authenticated.
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
  closed_status text;
  closed_id uuid;
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from a then
    raise exception 'FAIL A: niewłaściwa rola lub UID; test nie może działać jako administrator.';
  end if;

  insert into public.leads(id, company_name, phone, follow_up_date)
  values (test_lead_id, '__crm_rls_single_user_test__', '__test__', current_date)
  returning user_id into actual_owner;
  if actual_owner is distinct from a then
    raise exception 'FAIL A: domyślny user_id nie wskazuje A.';
  end if;
  if not exists (select 1 from public.leads where id = test_lead_id and user_id = a) then
    raise exception 'FAIL A: własny lead nie jest widoczny.';
  end if;
  update public.leads set next_step = '__owner_A__' where id = test_lead_id;
  get diagnostics affected = row_count;
  if affected <> 1 or not exists (
    select 1 from public.leads where id = test_lead_id and next_step = '__owner_A__'
  ) then
    raise exception 'FAIL A: aktualizacja własnego leada nie działa.';
  end if;

  insert into public.lead_activities(lead_id, type, content)
  values (test_lead_id, 'note', '__note_A__');
  insert into public.lead_activities(lead_id, type, content, occurred_at)
  values (test_lead_id, 'contact', '__contact_A__', now());
  if (select count(*) from public.lead_activities where lead_id = test_lead_id) <> 2 then
    raise exception 'FAIL A: dodawanie lub odczyt własnych aktywności nie działa.';
  end if;
  if (select last_contact_at from public.leads where id = test_lead_id) is distinct from now() then
    raise exception 'FAIL A: trigger kontaktu nie działa jako authenticated.';
  end if;

  delete from public.leads where id = test_lead_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL A: usunięto aktywnego leada.'; end if;

  foreach closed_status in array array['won', 'lost'] loop
    closed_id := current_setting('crm_test.' || closed_status || '_lead')::uuid;
    insert into public.leads(id, company_name, phone, status)
    values (closed_id, '__crm_rls_closed_test__', '__test__', closed_status);
    insert into public.lead_activities(lead_id, type, content)
    values (closed_id, 'note', '__cascade_test__');
  end loop;

  -- Pełny obraz danych, bez ograniczania porównania do liczby zdarzeń.
  perform set_config('crm_test.lead_snapshot', (
    select to_jsonb(l)::text from public.leads l where l.id = test_lead_id
  ), true);
  perform set_config('crm_test.activities_snapshot', (
    select jsonb_agg(to_jsonb(la) order by la.id)::text
    from public.lead_activities la where la.lead_id = test_lead_id
  ), true);

  for test_case in select * from (values
    -- 23503 (brak B w auth.users) NIE jest dowodem działania WITH CHECK.
    ('zmiana właściciela', format('update public.leads set user_id = %L where id = %L', b, test_lead_id)),
    ('UPDATE historii', format($$update public.lead_activities set content = '__forbidden_A__' where lead_id = %L$$, test_lead_id)),
    ('DELETE historii', format('delete from public.lead_activities where lead_id = %L', test_lead_id))
  ) as cases(label, statement) loop
    observed_state := null;
    begin
      execute test_case.statement;
    exception when others then
      observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'FAIL A (%): oczekiwano odmowy 42501, otrzymano %.',
        test_case.label, coalesce(observed_state, 'brak błędu');
    end if;
  end loop;
end;
$owner_a$;

-- Supabase Auth może nadać rolę authenticated również sesji anonimowej.
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_a'), 'role', 'authenticated', 'is_anonymous', true)::text, true);
do $anonymous_auth$
begin
  delete from public.leads where id = current_setting('crm_test.won_lead')::uuid;
  if found then raise exception 'FAIL: sesja anonimowa Supabase Auth usunęła leada.'; end if;
end;
$anonymous_auth$;

-- B: tylko symulowany sub. Bez INSERT do auth.users ani leada z user_id B.
select set_config('request.jwt.claim.sub', current_setting('crm_test.user_b'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_b'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $simulated_b$
declare
  b uuid := current_setting('crm_test.user_b')::uuid;
  test_lead_id uuid := current_setting('crm_test.lead_a')::uuid;
  affected bigint;
  activity_type text;
  observed_state text;
begin
  if current_user <> 'authenticated' or auth.uid() is distinct from b then
    raise exception 'FAIL B: niewłaściwa rola lub symulowany UID.';
  end if;
  if exists (select 1 from public.leads where id = test_lead_id)
    or exists (select 1 from public.lead_activities where lead_id = test_lead_id) then
    raise exception 'FAIL B: lead lub historia A są widoczne.';
  end if;

  -- USING powinno odfiltrować rekord: brak wyjątku, ale dokładnie 0 zmian.
  update public.leads set next_step = '__forbidden_B__' where id = test_lead_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL B: zmodyfikowano leada A.'; end if;
  update public.leads set user_id = b where id = test_lead_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL B: przejęto leada A.'; end if;

  delete from public.leads where id = current_setting('crm_test.won_lead')::uuid;
  if found then raise exception 'FAIL B: usunięto zakończonego leada A.'; end if;

  foreach activity_type in array array['note', 'contact', 'status_change'] loop
    observed_state := null;
    begin
      insert into public.lead_activities(lead_id, type, content)
      values (test_lead_id, activity_type, '__forbidden_B__');
    exception when others then
      observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'FAIL B (aktywność %): oczekiwano odmowy 42501, otrzymano %.',
        activity_type, coalesce(observed_state, 'brak błędu');
    end if;
  end loop;
end;
$simulated_b$;

-- Gość: brak UID oraz rzeczywista rola anon, bez uprawnień administratora.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $anonymous$
declare
  test_lead_id uuid := current_setting('crm_test.lead_a')::uuid;
  a uuid := current_setting('crm_test.user_a')::uuid;
  test_case record;
  observed_state text;
begin
  if current_user <> 'anon' or auth.uid() is not null then
    raise exception 'FAIL anon: wymagana rola anon bez UID.';
  end if;
  for test_case in select * from (values
    ('SELECT leads', format('select * from public.leads where id = %L', test_lead_id)),
    ('SELECT historii', format('select * from public.lead_activities where lead_id = %L', test_lead_id)),
    ('INSERT leads', format($$insert into public.leads(user_id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, a)),
    ('UPDATE leads', format($$update public.leads set next_step = '__forbidden_anon__' where id = %L$$, test_lead_id)),
    ('DELETE leads', format('delete from public.leads where id = %L', current_setting('crm_test.won_lead')::uuid)),
    ('INSERT historii', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', '__forbidden_anon__')$$, test_lead_id)),
    ('UPDATE historii', format($$update public.lead_activities set content = '__forbidden_anon__' where lead_id = %L$$, test_lead_id)),
    ('DELETE historii', format('delete from public.lead_activities where lead_id = %L', test_lead_id))
  ) as cases(label, statement) loop
    observed_state := null;
    begin
      execute test_case.statement;
    exception when others then
      observed_state := sqlstate;
    end;
    if observed_state is distinct from '42501' then
      raise exception 'FAIL anon (%): oczekiwano odmowy 42501, otrzymano %.',
        test_case.label, coalesce(observed_state, 'brak błędu');
    end if;
  end loop;
end;
$anonymous$;

-- Powrót do A: porównanie WSZYSTKICH kolumn leada i pełnej historii.
select set_config('request.jwt.claim.sub', current_setting('crm_test.user_a'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('crm_test.user_a'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $unchanged$
declare
  test_lead_id uuid := current_setting('crm_test.lead_a')::uuid;
  actual_lead jsonb;
  actual_activities jsonb;
  closed_status text;
  closed_id uuid;
begin
  if current_user <> 'authenticated'
    or auth.uid() is distinct from current_setting('crm_test.user_a')::uuid then
    raise exception 'FAIL kontrola końcowa: wymagana rola authenticated z UID A.';
  end if;
  select to_jsonb(l) into actual_lead from public.leads l where l.id = test_lead_id;
  select jsonb_agg(to_jsonb(la) order by la.id) into actual_activities
  from public.lead_activities la where la.lead_id = test_lead_id;

  if actual_lead is distinct from current_setting('crm_test.lead_snapshot')::jsonb then
    raise exception 'FAIL: lead A zmienił się lub zniknął po zabronionych operacjach.';
  end if;
  if actual_activities is distinct from current_setting('crm_test.activities_snapshot')::jsonb then
    raise exception 'FAIL: historia A zmieniła się lub zniknęła po zabronionych operacjach.';
  end if;

  foreach closed_status in array array['won', 'lost'] loop
    closed_id := current_setting('crm_test.' || closed_status || '_lead')::uuid;
    delete from public.leads where id = closed_id;
    if not found then raise exception 'FAIL A: nie usunięto własnego leada %.', closed_status; end if;
  end loop;
end;
$unchanged$;

-- Sprawdzenie fizycznego usunięcia historii. RLS użytkownika ukryłoby osierocone wpisy.
reset role;
do $cascade$
begin
  if exists (
    select 1 from public.lead_activities
    where lead_id in (current_setting('crm_test.won_lead')::uuid, current_setting('crm_test.lost_lead')::uuid)
  ) then raise exception 'FAIL: aktywności pozostały po usunięciu leada.'; end if;
end;
$cascade$;

-- Celowo PRZED ROLLBACK: błąd asercji blokuje ten SELECT w przerwanej transakcji.
-- PASS po ROLLBACK mógłby zostać wykonany mimo wcześniejszego błędu testu.
select 'PASS: Testy RLS z jednym kontem zakończone poprawnie' as wynik;
rollback;
