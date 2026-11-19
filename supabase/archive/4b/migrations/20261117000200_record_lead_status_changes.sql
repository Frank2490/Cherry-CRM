-- Etap 4B. Zmiana statusu i jej historia należą do tej samej transakcji.
-- Nie uzupełnia historii wstecz i nie zmienia RLS ani istniejących rekordów.
begin;

create function public.record_lead_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.lead_activities (lead_id, type, content)
  values (
    new.id,
    'status_change',
    pg_catalog.jsonb_build_object('from_status', old.status, 'to_status', new.status)::text
  );
  return new;
end;
$$;

revoke all on function public.record_lead_status_change() from public, anon, authenticated;

create trigger leads_record_status_change
  after update of status on public.leads
  for each row
  when (old.status is distinct from new.status)
  execute function public.record_lead_status_change();

commit;
