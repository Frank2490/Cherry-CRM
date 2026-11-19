-- Etap 8B.3: idempotentne tworzenie leada w obrębie konta użytkownika.
-- NULL zachowuje kompatybilność istniejących rekordów. Bez uzupełniania danych.
begin;

alter table public.leads
  add column creation_request_id uuid null,
  add constraint leads_user_creation_request_id_key
    unique (user_id, creation_request_id);

commit;
