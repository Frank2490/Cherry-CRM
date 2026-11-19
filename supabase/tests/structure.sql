-- Wyłącznie baza lokalna/testowa po migracjach 2B, 3B i 4C. Nie uruchamiaj na produkcji.
-- Wstaw UUID ISTNIEJĄCEGO konta A. Ten skrypt nie tworzy użytkowników.
-- Wykonaj CAŁY plik: dane testowe są wycofywane przez ROLLBACK.
begin;
select set_config('crm_test.user_a', 'f3a6640b-1da4-49cc-bee9-aaffcaea295e', true);

do $test$
declare
  owner_id uuid := nullif(current_setting('crm_test.user_a'), '')::uuid;
  lead public.leads%rowtype;
  event public.lead_activities%rowtype;
  test_case record;
  observed_state text;
  saved_contact timestamptz;
  allowed_status text;
  optional_date date;
begin
  if owner_id is null or not exists (select 1 from auth.users where id = owner_id) then
    raise exception 'Wstaw UUID istniejącego konta A w crm_test.user_a.';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'estimated_value' and data_type = 'numeric'
      and numeric_precision = 12 and numeric_scale = 2
  ) then raise exception 'Niepoprawny typ estimated_value.'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name = 'notes' and data_type = 'text' and is_nullable = 'YES'
  ) then raise exception 'Pole notes powinno mieć typ TEXT NULL.'; end if;

  insert into public.leads (company_name, email, follow_up_date, updated_at)
  values ('__crm_structure_test__', '__test__', current_date, '2000-01-01 00:00:00+00')
  returning * into lead;
  if lead.id is null or lead.user_id <> owner_id or lead.status <> 'new'
    or lead.created_at is null or lead.updated_at is null
    or lead.service_type is not null or lead.estimated_value is not null or lead.notes is not null then
    raise exception 'Niepoprawne wartości domyślne lub pola opcjonalne.';
  end if;

  update public.leads set next_step = '__test__', updated_at = '2000-01-01 00:00:00+00'
  where id = lead.id returning * into lead;
  if lead.updated_at <> now() then raise exception 'Trigger updated_at nie działa.'; end if;

  update public.leads set client_needs = '__existing_needs__', client_concerns = '__existing_concerns__'
  where id = lead.id;
  update public.leads set notes = E'Pierwsza linia\nDruga linia'
  where id = lead.id returning * into lead;
  if lead.notes is distinct from E'Pierwsza linia\nDruga linia'
    or lead.client_needs is distinct from '__existing_needs__'
    or lead.client_concerns is distinct from '__existing_concerns__' then
    raise exception 'Zapis notatek nie zachowuje treści lub dawnych danych.';
  end if;
  update public.leads set notes = null where id = lead.id returning * into lead;
  if lead.notes is not null or exists (select 1 from public.lead_activities where lead_id = lead.id) then
    raise exception 'Czyszczenie notatek nie daje NULL lub zapis tworzy zbędną aktywność.';
  end if;

  foreach allowed_status in array array['new', 'interested', 'visualization_sent', 'proposal', 'decision', 'won', 'lost'] loop
    insert into public.leads (company_name, phone, status, follow_up_date, service_type, estimated_value)
    values ('__crm_status_test__', '__test__', allowed_status,
      case when allowed_status in ('won', 'lost') then null else current_date end,
      'dowolny typ usługi', 0);
    if allowed_status not in ('won', 'lost') then
      insert into public.leads (company_name, phone, status)
      values ('__crm_no_follow_up_test__', '__test__', allowed_status)
      returning follow_up_date into optional_date;
      if optional_date is not null then
        raise exception 'Aktywny lead bez wybranej daty nie ma NULL.';
      end if;
      insert into public.leads (company_name, phone, status, follow_up_date)
      values ('__crm_null_follow_up_test__', '__test__', allowed_status, null);
    end if;
  end loop;

  insert into public.leads (company_name, phone)
  values ('__crm_default_no_follow_up_test__', '__test__')
  returning follow_up_date into optional_date;
  if optional_date is not null then
    raise exception 'Nowy lead domyślnie powinien mieć pusty termin.';
  end if;

  -- Każdy przypadek ma sprawdzić konkretny SQLSTATE, a nie dowolny błąd.
  for test_case in select * from (values
    ('pusta nazwa', $$insert into public.leads(company_name, phone, follow_up_date) values ('', '__test__', current_date)$$, '23514'),
    ('białe znaki w nazwie', $$insert into public.leads(company_name, phone, follow_up_date) values (E' \t\n', '__test__', current_date)$$, '23514'),
    ('nazwa NULL', $$insert into public.leads(company_name, phone, follow_up_date) values (null, '__test__', current_date)$$, '23502'),
    ('brak kontaktu', $$insert into public.leads(company_name, follow_up_date) values ('__test__', current_date)$$, '23514'),
    ('kontakt tylko białe znaki', $$insert into public.leads(company_name, instagram, email, phone, follow_up_date) values ('__test__', ' ', E'\t', '', current_date)$$, '23514'),
    ('niepoprawny status', $$insert into public.leads(company_name, phone, status, follow_up_date) values ('__test__', '__test__', 'invalid', current_date)$$, '23514'),
    ('status NULL', $$insert into public.leads(company_name, phone, status, follow_up_date) values ('__test__', '__test__', null, current_date)$$, '23502'),
    ('won z datą', $$insert into public.leads(company_name, phone, status, follow_up_date) values ('__test__', '__test__', 'won', current_date)$$, '23514'),
    ('lost z datą', $$insert into public.leads(company_name, phone, status, follow_up_date) values ('__test__', '__test__', 'lost', current_date)$$, '23514'),
    ('ujemna wartość', $$insert into public.leads(company_name, phone, follow_up_date, estimated_value) values ('__test__', '__test__', current_date, -0.01)$$, '23514'),
    ('NaN', $$insert into public.leads(company_name, phone, follow_up_date, estimated_value) values ('__test__', '__test__', current_date, 'NaN')$$, '23514'),
    ('przekroczenie NUMERIC(12,2)', $$insert into public.leads(company_name, phone, follow_up_date, estimated_value) values ('__test__', '__test__', current_date, 10000000000)$$, '22003'),
    ('brak właściciela', $$insert into public.leads(user_id, company_name, phone, follow_up_date) values (null, '__test__', '__test__', current_date)$$, '23502'),
    ('FK auth.users', format($$insert into public.leads(user_id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, gen_random_uuid()), '23503'),
    ('PK leads', format($$insert into public.leads(id, company_name, phone, follow_up_date) values (%L, '__test__', '__test__', current_date)$$, lead.id), '23505'),
    ('FK activities', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', '__test__')$$, gen_random_uuid()), '23503'),
    ('pusta notatka', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', '')$$, lead.id), '23514'),
    ('notatka z białych znaków', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', E' \t\n')$$, lead.id), '23514'),
    ('treść NULL', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'note', null)$$, lead.id), '23502'),
    ('niepoprawny typ', format($$insert into public.lead_activities(lead_id, type, content) values (%L, 'invalid', '__test__')$$, lead.id), '23514'),
    ('niepoprawny kanał', format($$insert into public.lead_activities(lead_id, type, content, channel) values (%L, 'contact', '__test__', 'invalid')$$, lead.id), '23514'),
    ('occurred_at NULL', format($$insert into public.lead_activities(lead_id, type, content, occurred_at) values (%L, 'note', '__test__', null)$$, lead.id), '23502')
  ) as cases(label, statement, expected_state) loop
    observed_state := null;
    begin
      execute test_case.statement;
    exception when others then
      observed_state := sqlstate;
    end;
    if observed_state is distinct from test_case.expected_state then
      raise exception 'FAIL %: oczekiwano %, otrzymano %', test_case.label, test_case.expected_state, observed_state;
    end if;
  end loop;

  insert into public.lead_activities(lead_id, type, content)
  values (lead.id, 'note', '__test__') returning * into event;
  if event.id is null or event.occurred_at <> now() or event.channel is not null then
    raise exception 'Niepoprawne wartości domyślne aktywności.';
  end if;
  insert into public.lead_activities(lead_id, type, content)
  values (lead.id, 'status_change', '__test__');
  if (select last_contact_at from public.leads where id = lead.id) is not null then
    raise exception 'Notatka lub zmiana statusu zmienia last_contact_at.';
  end if;

  saved_contact := now() - interval '2 days';
  insert into public.lead_activities(lead_id, type, content, channel, occurred_at)
  values (lead.id, 'contact', '__test__', 'phone', saved_contact);
  if (select last_contact_at from public.leads where id = lead.id) is distinct from saved_contact then
    raise exception 'Kontakt nie aktualizuje last_contact_at.';
  end if;
  insert into public.lead_activities(lead_id, type, content, occurred_at)
  values (lead.id, 'contact', '__test__', saved_contact - interval '1 day');
  if (select last_contact_at from public.leads where id = lead.id) is distinct from saved_contact then
    raise exception 'Starszy kontakt cofa last_contact_at.';
  end if;
  insert into public.lead_activities(lead_id, type, content, occurred_at)
  values (lead.id, 'note', '__test__', now());
  if (select last_contact_at from public.leads where id = lead.id) is distinct from saved_contact then
    raise exception 'Późniejsza notatka zmienia last_contact_at.';
  end if;
  insert into public.lead_activities(lead_id, type, content, occurred_at)
  values (lead.id, 'contact', '__test__', now());
  if (select last_contact_at from public.leads where id = lead.id) is distinct from now() then
    raise exception 'Nowszy kontakt nie przesuwa last_contact_at.';
  end if;

  -- Test administracyjny FK, nie dowód uprawnień użytkownika do DELETE.
  delete from public.leads where id = lead.id;
  if exists (select 1 from public.lead_activities where lead_id = lead.id) then
    raise exception 'ON DELETE CASCADE nie działa.';
  end if;
  raise notice 'PASS: struktura, wartości domyślne, CHECK, PK, FK, daty i triggery. Dane zostaną wycofane.';
end;
$test$;

rollback;
