# Baza danych CRM — etapy 2B, 3B, 4C i 8B.3

## Etap 8B.3 — ochrona przed duplikowaniem leadów

Migracja `migrations/20261119000100_add_lead_creation_request_id.sql` dodaje
`creation_request_id UUID NULL` oraz ograniczenie
`UNIQUE (user_id, creation_request_id)`. Nie uzupełnia ani nie aktualizuje
istniejących danych; ich nowe pole pozostaje NULL. Nie zmienia Auth, RLS,
triggerów, statusów ani terminów. Unikalność dotyczy operacji danego konta,
nie nazwy firmy lub danych kontaktowych. **Migracja nie została wykonana zdalnie.**

UUID powstaje w przeglądarce przy pierwszym wysłaniu formularza. Pozostaje
przypisany do szkicu po błędach i po zamknięciu/ponownym otwarciu modala.
Po potwierdzonym sukcesie kolejny zapis nowego formularza otrzymuje nowy UUID.
Identyfikator oraz szkic są przechowywane w pamięci komponentu; nie zapisujemy
ich w localStorage ani w cookies. Pełne przeładowanie strony rozpoczyna nowy formularz.

Server Action sprawdza UUID i ustala właściciela z Auth. Wykonuje zwykły INSERT;
unikalny indeks rozstrzyga także równoczesne żądania. Przy błędzie `23505`
odczytuje ID po **obu filtrach**: właściciel i UUID operacji. Zwraca ten sam
wynik `{ ok: true, lead: { id } }`. Nie wykonuje UPDATE ani upsertu, więc
ponowienie nie zmienia danych lub `updated_at` istniejącego leada, również
gdy został on już później wyedytowany. Pierwszy udany zapis jest rozstrzygający.

### Zastosowanie migracji

Najpierw zastosuj migrację, potem wdrażaj nową wersję formularza. Bez kolumny
aplikacja pokaże informację o wymaganej migracji 8B.3 i zachowa szkic.

W Supabase Dashboard wybierz właściwy projekt, otwórz **SQL Editor** i wykonaj
cały plik `20261119000100_add_lead_creation_request_id.sql`, od BEGIN do COMMIT.
Ręczne wykonanie SQL nie zapisuje historii Supabase CLI. Jeżeli później użyjesz
CLI, uzgodnij historię wyłącznie po sprawdzeniu rzeczywistego zastosowania SQL.

Przy skonfigurowanym i powiązanym CLI oraz uzgodnionej historii wcześniejszych
migracji sprawdź plan przez `npx supabase db push --dry-run`. Powinien zawierać
tylko nową migrację 8B.3. Dopiero po sprawdzeniu projektu i planu zastosuj ją
poleceniem `npx supabase db push`. Żadne z tych poleceń nie zostało tu uruchomione.

### Weryfikacja

Testy Node używają rzeczywistego klienta Supabase z całkowicie lokalną atrapą
transportu i modelem unikalności. Sprawdzają ponowienia, dwa równoczesne
żądania, utratę odpowiedzi po zatwierdzonym INSERT, izolację kont, nowe UUID,
niezmienność istniejącego rekordu oraz błędy. Testy formularza sprawdzają
zachowanie szkicu i UUID oraz ich reset po sukcesie. Nie zastępują one testu
unikalnego indeksu w rzeczywistym PostgreSQL.

`tests/creation_idempotency.sql` jest przeznaczony **wyłącznie dla lokalnej lub
testowej bazy po migracji**. Wstaw UUID istniejącego konta w `crm_test.user_a`
i wykonaj cały plik. Asercje zapisu/odczytu działają jako `authenticated`,
a transakcja kończy się ROLLBACK. Nie tworzy kont Auth. Nie został uruchomiony
w silniku SQL, ponieważ środowisko nie ma PostgreSQL/psql.

Po zastosowaniu migracji w środowisku testowym sprawdź również dwie
równoczesne próby zapisu z identycznym UUID oraz ponowienie po przerwaniu
odpowiedzi. Oczekiwane: jeden rekord i to samo ID w obu odpowiedziach.
Nie przeprowadzaj tych prób na danych produkcyjnych.

## Stan wykonania

Migracja `migrations/20261116000100_create_leads_and_activities.sql` została wykonana w Supabase. Użytkownik potwierdził poprawne wykonanie pierwotnego testu struktury i RLS z jednym istniejącym kontem. Historyczna migracja oraz oba skrypty RLS pozostają bez zmian.

Etap 3B dodał migrację `migrations/20261117000100_optional_active_follow_up.sql` i aktualizuje `tests/structure.sql`. Nowy SQL zmienia tylko CHECK `leads_follow_up_matches_status`: aktywny lead może nie mieć daty, a `won`/`lost` nadal wymagają NULL. Nie zmienia danych, tabel, pozostałych ograniczeń, grantów ani polityk. Formularz bez daty wymaga zastosowania tej migracji.

W repozytorium istnieje lokalne powiązanie CLI (`supabase/.temp`), ale brakuje `supabase/config.toml`. W środowisku wykonawczym nie ma zainstalowanego Supabase CLI ani PostgreSQL/psql. Nowa migracja przeszła przegląd statyczny, ale nie została uruchomiona w silniku SQL. Nie odczytywano zdalnej historii i nie wykonano automatycznie żadnych zmian zdalnej bazy.

## Etap 4C — opcjonalne notatki leada

Nowa migracja `migrations/20261118000100_add_lead_notes.sql` dodaje tylko `notes TEXT NULL` do `public.leads`. Istniejące rekordy otrzymają NULL w nowym polu; ich pozostałe wartości pozostają bez zmian. Nie ma usuwania kolumn lub danych, modyfikacji RLS, relacji ani triggerów. **Nie wykonano jej na zdalnej bazie.**

Migracja 4B `20261117000200_record_lead_status_changes.sql`, zgodnie z informacją użytkownika niewdrożona, została przeniesiona bez zmian do `archive/4b/migrations/`. Jej zależny test jest w `archive/4b/tests/activities.sql`. Nie ma już tego pliku w aktywnym katalogu migracji. Nie zmieniano zdalnej historii CLI ani nie wykonywano żadnego `migration repair`. Stan niewdrożenia 4B opiera się na potwierdzeniu użytkownika, nie na automatycznym odczycie bazy.

Aktywny katalog `supabase/migrations/` zawiera teraz:

- `20261116000100_create_leads_and_activities.sql` — historyczna migracja 2B, bez zmian.
- `20261117000100_optional_active_follow_up.sql` — historyczna migracja 3B, bez zmian.
- `20261118000100_add_lead_notes.sql` — nowa migracja 4C, niewykonana przez agenta.
- `20261119000100_add_lead_creation_request_id.sql` — migracja 8B.3, niewykonana przez agenta.

Przy działającym powiązaniu CLI:

```bash
cd /Users/franciszeksolewicz/Desktop/CRM
npx supabase@latest migration list --remote
npx supabase@latest db push --dry-run --remote
```

Sprawdź właściwy projekt i historię. Plan powinien zawierać **wyłącznie `20261118000100_add_lead_notes.sql`**, bez migracji 4B. Poprzednie wykonane migracje powinny być uzgodnione w historii. W razie rozbieżności nie uruchamiaj `db push`, dopóki ich nie wyjaśnisz; nie oznaczaj niezaaplikowanego SQL jako wykonanego. Po sprawdzeniu planu:

```bash
npx supabase@latest db push --remote
npx supabase@latest migration list --remote
```

Jeśli brakuje sesji/powiązania, użyj `npx supabase@latest login` oraz `npx supabase@latest link --project-ref TWOJ_PROJECT_REF`. `init` wykonuj tylko przy braku `supabase/config.toml`, bez `--force`. Powyższe polecenia nie zostały wykonane automatycznie.

Alternatywnie uruchom cały nowy plik w SQL Editor właściwego projektu, od BEGIN do COMMIT. Ręczne wykonanie SQL nie zapisuje historii CLI. Dopiero po udanym zastosowaniu i kontroli kolumny można uzgodnić tę jedną wersję przez `npx supabase@latest migration repair 20261118000100 --status applied --remote`. To zmienia historię, nie wykonuje schematu. Nie przywracaj migracji 4B do katalogu aktywnego.

Kontrola kolumny po wdrożeniu (wyłącznie odczyt):

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'leads' and column_name = 'notes';
```

Oczekiwane: `notes`, `text`, `YES`, brak dodatkowego DEFAULT. W tabeli nadal powinny istnieć `client_needs`, `client_concerns` i `lead_activities`. Nowy formularz ich nie zapisuje i nie przenosi starych wartości do `notes`.

Test `tests/structure.sql` rozszerzono o kolumnę, domyślny NULL, zapis notatek i ich czyszczenie. Wszystkie dotychczasowe testy ograniczeń zachowano. Skrypt 4C nie został uruchomiony w PostgreSQL; uruchamiaj go wyłącznie na lokalnej/testowej bazie po migracji, z UUID istniejącego konta. Całość kończy się ROLLBACK. Automatyczne testy aplikacji korzystają z atrap i nie potwierdzają rzeczywistego zapisu na zdalnym projekcie.

## Struktura

### `public.leads`

| Kolumna | Typ | Reguła |
| --- | --- | --- |
| `id` | UUID | PK, domyślnie `gen_random_uuid()` |
| `user_id` | UUID | NOT NULL, FK do `auth.users(id)`, domyślnie `auth.uid()` |
| `creation_request_id` | UUID | po migracji 8B.3: opcjonalne; unikalne w parze z `user_id` |
| `company_name` | TEXT | NOT NULL, przynajmniej jeden znak inny niż biały znak |
| `instagram` | TEXT | opcjonalne |
| `email` | TEXT | opcjonalne |
| `phone` | TEXT | opcjonalne |
| `status` | TEXT | NOT NULL, domyślnie `new`, CHECK dozwolonych statusów |
| `service_type` | TEXT | opcjonalne, dowolny tekst |
| `estimated_value` | NUMERIC(12,2) | opcjonalne, >= 0; `NaN` odrzucone |
| `follow_up_date` | DATE | po migracji 3B: opcjonalne dla aktywnego statusu; NULL dla `won`/`lost` |
| `last_contact_at` | TIMESTAMPTZ | opcjonalne |
| `next_step` | TEXT | opcjonalne |
| `notes` | TEXT | po migracji 4C: opcjonalne, domyślnie NULL |
| `client_needs` | TEXT | zachowane dane; pole niewidoczne w panelu 4C |
| `client_concerns` | TEXT | zachowane dane; pole niewidoczne w panelu 4C |
| `created_at` | TIMESTAMPTZ | NOT NULL, domyślnie `now()` |
| `updated_at` | TIMESTAMPTZ | NOT NULL, domyślnie `now()`, trigger przed UPDATE |

Statusy: `new`, `interested`, `visualization_sent`, `proposal`, `decision`, `won`, `lost`. Aktywny oznacza każdy z pierwszych pięciu statusów. Nie ma osobnej flagi aktywności. Przy zamykaniu leada status i usunięcie daty follow-upu należy zapisać w jednym UPDATE; po migracji 3B ponowne otwarcie nie wymaga podania daty. Daty zaległe są dozwolone.

Co najmniej jedno z pól `instagram`, `email`, `phone` musi zawierać znak inny niż biały znak. CHECK sprawdza obecność kontaktu, bez narzucania formatów telefonów, profili czy adresów. Typ usługi i wartość nie są wymagane. FK użytkownika ma domyślne `NO ACTION`: nie dodano automatycznego usuwania leadów przy usunięciu konta Auth.

### `public.lead_activities`

| Kolumna | Typ | Reguła |
| --- | --- | --- |
| `id` | UUID | PK, domyślnie `gen_random_uuid()` |
| `lead_id` | UUID | NOT NULL, FK do `leads(id)`, ON DELETE CASCADE |
| `type` | TEXT | NOT NULL, `note`, `contact` lub `status_change` |
| `content` | TEXT | NOT NULL, przynajmniej jeden znak inny niż biały znak |
| `channel` | TEXT | NULL lub `instagram`, `email`, `phone`, `other` |
| `occurred_at` | TIMESTAMPTZ | NOT NULL, domyślnie `now()` |

Relacja: jeden lead ma wiele aktywności. Dodanie `contact` aktualizuje `last_contact_at` tylko wtedy, gdy nie ma daty albo nowy kontakt jest późniejszy. Starszy kontakt pozostaje w historii, ale nie cofa daty ostatniego kontaktu. Notatka i `status_change` nie zmieniają tej daty. Automatyczna historia statusów z etapu 4B nie jest wdrażana: migracja znajduje się w archiwum. Panel 4C nie korzysta z lead_activities; istniejące rekordy i mechanizm daty kontaktu pozostają nienaruszone.

Obie funkcje triggerów etapu 2B mają `SECURITY INVOKER`, pusty `search_path` i jawnie wskazane obiekty. Trigger kontaktu respektuje RLS i grant UPDATE właściciela leada. Funkcje nie mają grantów EXECUTE dla ról API i nie są interfejsem RPC; triggery tworzy administrator. `updated_at` używa `now()`, czyli czasu początku transakcji PostgreSQL — kolejne zmiany w tej samej transakcji mogą mieć ten sam znacznik czasu.

### Indeksy

- `leads(user_id, status)` — własne leady i filtrowanie statusu; prefiks obsługuje samo `user_id`.
- `leads(user_id, follow_up_date) WHERE follow_up_date IS NOT NULL` — terminy kontaktu.
- `lead_activities(lead_id, occurred_at DESC)` — historia od najnowszych zdarzeń oraz obsługa FK.

PK automatycznie tworzą własne indeksy. Nie dodano redundantnego indeksu tylko na `user_id`.

## RLS i granty

Obie tabele mają włączone RLS. Granty tabel dla `PUBLIC`, `anon` i `authenticated` są najpierw cofane, także te pochodzące z domyślnych uprawnień Supabase. Następnie `authenticated` otrzymuje wyłącznie:

- `leads`: SELECT, INSERT, UPDATE. SELECT/UPDATE mają `USING ((SELECT auth.uid()) = user_id)`; INSERT/UPDATE mają taki sam `WITH CHECK`. Nie da się zapisać cudzego właściciela ani przenieść własnego leada na inne konto. Brak grantu i polityki DELETE.
- `lead_activities`: SELECT i INSERT. Polityki sprawdzają przez `EXISTS` własność powiązanego leada. Brak grantów i polityk UPDATE/DELETE.

Anonimowy dostęp nie ma ani grantów tabel, ani polityk. Usunięcie leada przez uprawnionego administratora usuwa powiązaną historię przez FK; nie daje to użytkownikowi uprawnienia DELETE. Nie użyto funkcji omijających RLS ani kluczy uprzywilejowanych w aplikacji.

Wzorzec polityk i rozdzielenie grantów od RLS opisuje [dokumentacja Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Zastosowanie migracji 3B przez CLI

Poniższe polecenia wykonuje właściciel projektu w swoim terminalu. Nie zostały uruchomione automatycznie. Nie uruchamiaj ponownie historycznej migracji tworzącej tabele.

1. Sprawdź aktualny CLI i konfigurację:

   ```bash
   cd /Users/franciszeksolewicz/Desktop/CRM
   npx supabase@latest --version
   ```

   Jeśli nadal nie ma `supabase/config.toml`, wykonaj jednorazowo `npx supabase@latest init` bez `--force`. Nie nadpisuj istniejących migracji. W razie braku sesji CLI wykonaj `npx supabase@latest login`. Jeśli projekt nie jest powiązany lub powiązanie wskazuje inny projekt, wykonaj `npx supabase@latest link --project-ref TWOJ_PROJECT_REF`. Używaj interaktywnego podawania danych dostępu, bez zapisywania tokenów i haseł w repozytorium.

2. Zweryfikuj właściwy projekt i historię:

   ```bash
   npx supabase@latest migration list --remote
   ```

   Wersja `20261116000100` powinna być zastosowana lokalnie i zdalnie. Jeśli pierwotny SQL wykonano ręcznie w SQL Editor, historia CLI może jej nie zawierać. **Dopiero po sprawdzeniu zgodności całej pierwotnej migracji z rzeczywistym schematem** oznacz tę jedną wersję:

   ```bash
   npx supabase@latest migration repair 20261116000100 --status applied --remote
   npx supabase@latest migration list --remote
   ```

   `repair` zmienia wyłącznie historię, nie wykonuje SQL i nie naprawia schematu. Nie oznaczaj nowej migracji jako zastosowanej przed jej wykonaniem. Przy innych rozbieżnościach najpierw uzgodnij historię; nie nadpisuj zdalnych migracji.

3. Sprawdź plan, następnie świadomie zastosuj zmianę:

   ```bash
   npx supabase@latest db push --dry-run --remote
   npx supabase@latest db push --remote
   npx supabase@latest migration list --remote
   ```

   Plan powinien zawierać **wyłącznie `20261117000100_optional_active_follow_up.sql`**. Gdy zawiera starą migrację lub inne nieoczekiwane zmiany, nie wykonuj `db push`, dopóki nie uzgodnisz historii. `db push` faktycznie zmienia zdalną bazę. Nowa migracja jest jedną transakcją: usuwa dotychczasowy CHECK i dodaje jego łagodniejszą wersję o tej samej nazwie, bez usuwania rekordów.

Składnia aktualnego CLI i `--remote` jest opisana w [referencji db push](https://supabase.com/docs/reference/cli/supabase-db-push) oraz [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair). Starsze CLI mogą używać `--linked`; powyższe polecenia celowo wybierają `@latest`.

Po wdrożeniu sprawdź definicję w SQL Editor (to wyłącznie odczyt):

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.leads'::regclass
  and conname = 'leads_follow_up_matches_status';
```

Wynik ma dopuszczać dowolną datę lub NULL dla aktywnych statusów, ale tylko NULL dla `won`/`lost`. Uruchom ponownie zaktualizowany test struktury opisany poniżej. Sam odczyt definicji nie potwierdza wszystkich przypadków testowych.

## Kontrola w Supabase Dashboard

W **Table Editor**, w schemacie **public**, odśwież listę i otwórz `leads` oraz `lead_activities`. Sprawdź kolumny, typy, defaults, relacje FK i oznaczenie włączonego RLS. W **Authentication → Policies** / widoku **Policies** tabel sprawdź trzy polityki `leads` i dwie `lead_activities`. Nazwa sekcji może zależeć od wersji Dashboardu; SQL poniżej daje dokładną kontrolę niezależnie od UI:

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('leads', 'lead_activities');

select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('leads', 'lead_activities')
order by tablename, policyname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('leads', 'lead_activities');

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('leads', 'lead_activities')
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

Odczyt danych jako administrator w SQL Editor lub Table Editor **nie jest testem RLS**.

## Testy bazy

- `tests/structure.sql`: **wersja z etapu 3B pozostaje niewykonana**. Po nowej migracji wymaga UUID jednego istniejącego konta A. Sprawdza NUMERIC(12,2), wartości domyślne, opcjonalność pól, wszystkie statusy (w tym aktywne z pominiętą datą i jawnym NULL), błędne wartości, kontakty, zakaz daty dla zamkniętych leadów, PK/FK, `updated_at`, kontakt starszy/nowszy, brak wpływu notatki oraz ON DELETE CASCADE. To test struktury jako administrator, nie test RLS.
- `tests/rls.sql`: wymaga dwóch różnych, już istniejących kont A i B. Wykonuje operacje jako `authenticated` z odpowiednimi claims oraz jako `anon` bez UID, używając `SET LOCAL ROLE`. Sprawdza własność, odmowy dostępu, brak zmiany danych A po próbach B, niezmienność historii i działanie triggera przy ograniczonych uprawnieniach. Dodatkowe kontrole odrzucają role BYPASSRLS i własność tabel.

- `tests/rls_single_user.sql`: użytkownik potwierdził sukces w etapie 2B. Wymaga jednego rzeczywistego konta A; B jest symulowanym UUID i kontekstem JWT, bez tworzenia konta i bez INSERT leada dla B. Wszystkie kontrole dostępu wykonuje jako `authenticated`/`anon`, w transakcji zakończonej ROLLBACK. Nie zastępuje pełnej integracji drugiego rzeczywistego konta.

W odpowiednim pliku sprawdź wartości `crm_test.user_a` / `crm_test.user_b` UUID kont z **Authentication → Users**. Następnie uruchom **cały** odpowiedni skrypt w SQL Editor jako administrator mogący przełączyć role. Skrypty tworzą wyłącznie tymczasowe rekordy oznaczone `__crm_*_test__`, w transakcji zakończonej `ROLLBACK`; nie tworzą użytkowników. Niczego nie zapisują na stałe. Nie uruchamiaj samych fragmentów z INSERT. Po błędzie wykonaj `ROLLBACK;`; test nie jest wtedy zaliczony. Komunikaty `PASS` są generowane dopiero po wykonaniu asercji.

Gdy masz `psql`, alternatywą jest `psql` z opcjami `-v ON_ERROR_STOP=1 -f supabase/tests/structure.sql` lub `-f supabase/tests/rls.sql` i połączeniem do właściwej bazy podanym bez ujawniania hasła w historii poleceń. To zwykłe skrypty PostgreSQL, nie testy TAP; nie uruchamiaj ich przez `supabase test db`.

Jeżeli istnieje tylko jedno konto, użyj `tests/rls_single_user.sql`; pełny test dwóch rzeczywistych kont pozostaje niewykonany. Nie twórz dodatkowego użytkownika bez osobnej zgody. Ustawiane w testach claims emulują kontekst bazy; nie zastępują testu logowania i JWT w rzeczywistej aplikacji.
