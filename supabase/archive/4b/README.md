# Archiwum niewdrożonego etapu 4B

Migracja historii zmian statusów nie została wdrożona, zgodnie z potwierdzeniem użytkownika w etapie 4C. Zachowano jej oryginalną treść oraz zależny skrypt SQL bez zmian:

- `migrations/20261117000200_record_lead_status_changes.sql`
- `tests/activities.sql`

Ten katalog jest poza aktywnym `supabase/migrations/`. Supabase CLI nie powinien wdrażać tych plików podczas `db push`. Nie kopiuj ich do aktywnego katalogu przy wdrażaniu 4C. Test SQL z tego archiwum wymaga zarchiwizowanej funkcjonalności i nie jest testem bieżącego schematu 4C.

Tabela `lead_activities`, jej dane, polityki RLS oraz pierwotny trigger kontaktu z etapu 2B pozostają w bazie. Zachowany kod aktywności w aplikacji nie jest już podłączony do panelu. Bieżące notatki używają nowego pola `public.leads.notes` i wspólnego zapisu danych leada.
