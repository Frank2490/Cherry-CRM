-- Etap 4C: jedno opcjonalne pole notatek. Bez zmian istniejących danych i RLS.
begin;

alter table public.leads
  add column notes text null;

commit;
