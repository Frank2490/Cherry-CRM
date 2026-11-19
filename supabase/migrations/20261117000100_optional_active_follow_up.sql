-- Etap 3B: aktywny lead może nie mieć terminu. Zamknięty musi mieć NULL.
-- Zmiana dotyczy wyłącznie jednego CHECK; nie zmienia danych ani RLS.
begin;

alter table public.leads
  drop constraint leads_follow_up_matches_status;

alter table public.leads
  add constraint leads_follow_up_matches_status
  check (status not in ('won', 'lost') or follow_up_date is null);

commit;
