-- Wyłącznie lokalna/testowa baza po migracji 8B.3. Nie uruchamiaj na produkcji.
-- Wstaw poniżej UUID istniejącego konta Auth. Skrypt nie tworzy użytkowników.
-- Wykonaj CAŁY plik. Wszystkie dane testowe zostają wycofane przez ROLLBACK.
begin;
select set_config('crm_test.user_a', '00000000-0000-0000-0000-000000000000', true);

do $setup$
begin
  if not exists (
    select 1 from auth.users
    where id = current_setting('crm_test.user_a')::uuid
  ) then
    raise exception 'Wstaw UUID istniejącego konta Auth w crm_test.user_a.';
  end if;
end;
$setup$;

select set_config('request.jwt.claim.sub', current_setting('crm_test.user_a'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('crm_test.user_a'), 'role', 'authenticated'
)::text, true);
set local role authenticated;

do $test$
declare
  request_id uuid := gen_random_uuid();
  first_lead public.leads%rowtype;
  repeated_lead public.leads%rowtype;
  second_lead public.leads%rowtype;
  legacy_one uuid;
  legacy_two uuid;
  violated_constraint text;
begin
  insert into public.leads (company_name, instagram, creation_request_id)
  values ('__crm_create_request_test__', '__test__', request_id)
  returning * into first_lead;

  if first_lead.user_id is distinct from auth.uid()
    or first_lead.creation_request_id is distinct from request_id then
    raise exception 'Nieprawidłowy właściciel lub UUID operacji.';
  end if;

  begin
    insert into public.leads (company_name, phone, status, creation_request_id)
    values ('__nie_nadpisuj__', '__test__', 'won', request_id);
    raise exception 'Ta sama operacja utworzyła drugi rekord.';
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint <> 'leads_user_creation_request_id_key' then
      raise exception 'Naruszono inne ograniczenie: %.', violated_constraint;
    end if;
  end;

  select * into strict repeated_lead from public.leads
  where user_id = auth.uid() and creation_request_id = request_id;
  if to_jsonb(repeated_lead) is distinct from to_jsonb(first_lead) then
    raise exception 'Ponowienie zmieniło dane wcześniej utworzonego leada.';
  end if;

  insert into public.leads (company_name, instagram, creation_request_id)
  values (first_lead.company_name, first_lead.instagram, gen_random_uuid())
  returning * into second_lead;
  if second_lead.id = first_lead.id
    or second_lead.creation_request_id = first_lead.creation_request_id then
    raise exception 'Nowa operacja nie utworzyła osobnego leada.';
  end if;

  -- NULL nie blokuje dotychczasowych rekordów ani niezależnych starszych zapisów.
  insert into public.leads (company_name, phone)
  values ('__crm_legacy_request_test__', '__test__') returning id into legacy_one;
  insert into public.leads (company_name, phone)
  values ('__crm_legacy_request_test__', '__test__') returning id into legacy_two;
  if (
    select count(*) from public.leads
    where id in (legacy_one, legacy_two) and creation_request_id is null
  ) <> 2 then
    raise exception 'Pole creation_request_id nie zachowuje zgodności z NULL.';
  end if;
end;
$test$;

select 'PASS: Unikalność operacji tworzenia leada działa poprawnie' as result;
rollback;
