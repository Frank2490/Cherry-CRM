-- Etap 2B. Migracja nie zastępuje istniejących tabel ani funkcji.
-- Całość należy wykonać jednokrotnie, w jednej transakcji.
begin;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  company_name text not null,
  instagram text,
  email text,
  phone text,
  status text not null default 'new',
  service_type text,
  estimated_value numeric(12, 2),
  follow_up_date date,
  last_contact_at timestamptz,
  next_step text,
  client_needs text,
  client_concerns text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leads_company_name_not_blank
    check (company_name ~ '[^[:space:]]'),
  constraint leads_contact_required
    check (
      coalesce(instagram ~ '[^[:space:]]', false)
      or coalesce(email ~ '[^[:space:]]', false)
      or coalesce(phone ~ '[^[:space:]]', false)
    ),
  constraint leads_status_valid
    check (status in (
      'new', 'interested', 'visualization_sent', 'proposal',
      'decision', 'won', 'lost'
    )),
  constraint leads_estimated_value_nonnegative
    check (estimated_value >= 0 and estimated_value <> 'NaN'::numeric),
  constraint leads_follow_up_matches_status
    check (
      (status in ('won', 'lost') and follow_up_date is null)
      or (status not in ('won', 'lost') and follow_up_date is not null)
    )
);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null,
  content text not null,
  channel text,
  occurred_at timestamptz not null default now(),

  constraint lead_activities_type_valid
    check (type in ('note', 'contact', 'status_change')),
  constraint lead_activities_content_not_blank
    check (content ~ '[^[:space:]]'),
  constraint lead_activities_channel_valid
    check (channel in ('instagram', 'email', 'phone', 'other'))
);

-- Indeks z prefiksem user_id obsługuje również samo pobieranie własnych leadów.
create index leads_user_status_idx on public.leads (user_id, status);
create index leads_user_follow_up_idx
  on public.leads (user_id, follow_up_date)
  where follow_up_date is not null;
create index lead_activities_lead_occurred_idx
  on public.lead_activities (lead_id, occurred_at desc);

create function public.set_lead_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_lead_updated_at();

create function public.record_lead_last_contact()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Warunek zapobiega cofaniu daty przy dopisaniu starszego kontaktu.
  -- UPDATE blokuje wiersz i pozostaje objęty RLS osoby dodającej zdarzenie.
  update public.leads
  set last_contact_at = new.occurred_at
  where id = new.lead_id
    and (last_contact_at is null or last_contact_at < new.occurred_at);
  return new;
end;
$$;

create trigger lead_activities_record_contact
  after insert on public.lead_activities
  for each row when (new.type = 'contact')
  execute function public.record_lead_last_contact();

-- Funkcje triggerów nie są publicznym interfejsem RPC.
revoke all on function public.set_lead_updated_at() from public, anon, authenticated;
revoke all on function public.record_lead_last_contact() from public, anon, authenticated;

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;

-- Usuwamy również ewentualne granty odziedziczone z default privileges Supabase.
revoke all privileges on table public.leads, public.lead_activities
  from public, anon, authenticated;
grant select, insert, update on table public.leads to authenticated;
grant select, insert on table public.lead_activities to authenticated;

create policy leads_select_own on public.leads
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy leads_insert_own on public.leads
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy leads_update_own on public.leads
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy lead_activities_select_own on public.lead_activities
  for select to authenticated
  using (exists (
    select 1 from public.leads
    where leads.id = lead_activities.lead_id
      and leads.user_id = (select auth.uid())
  ));

create policy lead_activities_insert_own on public.lead_activities
  for insert to authenticated
  with check (exists (
    select 1 from public.leads
    where leads.id = lead_activities.lead_id
      and leads.user_id = (select auth.uid())
  ));

commit;
