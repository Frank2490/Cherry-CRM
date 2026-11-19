# CRM

Prywatny CRM: Next.js (App Router), TypeScript, Tailwind CSS i ESLint. Wspólny layout zawiera nazwę CRM, nawigację i przestrzeń na widoki. Język interfejsu i dokumentu: polski.

## Ochrona niezapisanych zmian — etap 8B.5

Panel edycji i formularz dodawania korzystają z jednego mechanizmu
`src/lib/navigation/use-unsaved-changes.ts`. X, Anuluj, Escape i kliknięcie
w tło pytają o odrzucenie zmienionego szkicu. Kliknięcia wewnątrz okna
nie zamykają go. Natywne potwierdzenie opisuje wybór:
**Anuluj — Pozostań i kontynuuj edycję**, **OK — Odrzuć zmiany**.
Bez zmian nie ma ostrzeżenia; poprawny zapis również go nie wyświetla.
Anulowanie zamknięcia zachowuje pola i identyfikator operacji dodawania.
Świadome odrzucenie czyści szkic; kolejne dodawanie jest nową operacją.

`UnsavedChangesGuard` w głównym layoucie chroni Wstecz/Dalej, a nawigacja
CRM używa `Link.onNavigate`. Anulowanie przejścia przywraca istniejący wpis
historii przed obsługą trasy przez Next.js — bez dodawania pustych wpisów
czy usuwania historii Dalej. Wykorzystywane jest Navigation API, z wariantem
History API dla starszych przeglądarek, zachowującym stan Next.js.
Wspólny `beforeunload` chroni odświeżenie i opuszczenie dokumentu.
Treść i przyciski tego ostatniego ostrzeżenia ustala przeglądarka;
na urządzeniach mobilnych zamknięcie aplikacji przez system może je pominąć.
Listenery są usuwane po odmontowaniu/ustaniu zmian. W trakcie zapisu
zamknięcie i przejście do innej trasy są zablokowane.

Testy: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` —
**199/199** zaliczonych. Nowe testy obejmują obie wersje historii,
anulowanie Wstecz/Dalej, wielokrotne próby, zakładki Next.js, sprzątanie
listenerów, zamykanie nowego szkicu, zachowanie danych po odmowie,
odrzucenie oraz zapis bez ostrzeżenia. Testy zapisu używają atrap SDK.
W Safari potwierdzono Wstecz z zachowaniem szkicu po odmowie,
zaakceptowane Wstecz i późniejsze Dalej, a także Escape oraz X
w formularzu dodawania i zachowanie szkicu po anulowaniu.
Nie wykonywano zapisów do produkcyjnej bazy ani zmian Supabase.

Do ręcznego odbioru pozostaje test na fizycznym telefonie (systemowy gest
Wstecz, dotykowe zamknięcie w tle) oraz rzeczywisty zapis w środowisku
testowym: po sukcesie zamknięcie/przejście nie może już ostrzegać.

## Wspólne daty — etap 8B.4

`src/lib/leads/dates.ts` zawiera wspólną strefę `Europe/Warsaw`, ustalanie
dzisiejszego dnia, listę czterech szybkich terminów i `followUpQuickDate()`.
Dodawanie leada, edycja oraz Wykonano/Przełóż korzystają z tej samej logiki,
niezależnie od strefy urządzenia. Przesuwamy dni kalendarzowe, nie okresy
po 24 godziny. Wynik pozostaje zwykłym `YYYY-MM-DD`.

Formatowanie dat i etykiet kalendarza jest w tym samym module. UTC służy
wyłącznie jako techniczny nośnik arytmetyki/formatowania wartości DATE;
dzisiejszy dzień ustalamy zawsze według Warszawy. Dotychczasowe eksporty
z modułów Pipeline, Follow-upów i Kalendarza zachowują zgodność. Kalendarz
wyboru terminu wskazuje warszawskie Dziś i zachowuje dotychczasową nawigację.
Daty dodania i ostatniego kontaktu w panelu są wyświetlane w Europe/Warsaw;
zapis `last_contact_at` jako TIMESTAMPTZ pozostaje bez zmian.

Testy: lint, build i **184/184** testów automatycznych zaliczonych.
`tests/lead-dates.test.mjs` uruchamia kontrolery formularzy i kalendarza
w pięciu osobnych strefach procesu: Warszawa, Los Angeles, Kiritimati,
Pago Pago i Kalkuta. Każda sprawdza 13 momentów: północ, zmianę miesiąca
i roku, 29 lutego oraz oba przejścia czasu letniego/zimowego. Testowane są
obie akcje Follow-upów, etykiety, wybór daty bez przesunięć i zgodność
grupowania z Pipeline/Kalendarzem. Testy używają lokalnych danych i atrap
React; nie wykonują zapisów w Supabase. Ręcznie pozostaje kontrola wyglądu
oraz wyboru/zapisu daty w przeglądarce z inną strefą urządzenia, w środowisku testowym.

## Przeciąganie leadów — etap 7

Pipeline obsługuje zmianę statusu przez przeciągnięcie całej karty między siedmioma istniejącymi kolumnami. Karta ma podgląd nad przewijaną tablicą, źródło jest przygaszone, a kolumna docelowa podświetlona swoim kolorem. Upuszczenie poza kolumnami, do tej samej kolumny i Escape nie zapisują zmian. Nie ma sortowania kart wewnątrz kolumn; dotychczasowe sortowanie terminów pozostaje.

Dodano jedną bezpośrednią zależność: `@dnd-kit/core@6.3.1` (wraz z jego zależnościami accessibility/utilities). Pozwala wykorzystać sprawdzone sensory myszy, dotyku i klawiatury bez modułu sortable. Mysz wymaga przesunięcia o 8 px; dotyk przytrzymania 250 ms z tolerancją 8 px. Szybkie przesunięcie palca nadal przewija tablicę. Zastosowano TouchSensor i `touch-action: manipulation` zgodnie z [dokumentacją dnd-kit](https://dndkit.com/legacy/api-documentation/sensors/touch/). Podgląd `DragOverlay` nie jest przycinany przez poziomo przewijany obszar.

Klawiatura: Tab przechodzi do karty, Enter otwiera istniejący panel, Spacja chwyta, ←/→ wybierają sąsiednią kolumnę, Spacja/Enter upuszczają, Escape anuluje. Tab podczas przeciągania kończy operację zgodnie z zachowaniem KeyboardSensor. Komunikaty dla czytników ekranu są po polsku. Po anulowaniu lub zapisie przywracany jest fokus i widoczność karty, także po przewinięciu do odległej kolumny. Kliknięcie powstałe bezpośrednio po przeciągnięciu jest blokowane, żeby nie otwierać przypadkowo panelu.

`moveLeadStatus()` znajduje się w istniejącym `src/app/actions/leads.ts`. Używa dotychczasowego klienta SSR, weryfikacji użytkownika i RLS. Odczyt oraz zapis mają filtry ID i właściciela. UPDATE zmienia tylko `status`, a przy won/lost również `follow_up_date = NULL`; pozostałe dane są zachowane. Zaplanowany termin wymaga potwierdzenia przed zamknięciem. Serwer ponownie sprawdza bieżący status/datę, a UPDATE ma warunki porównujące poprzednie wartości, by nie nadpisać równoległej zmiany. Ten sam status nie wykonuje UPDATE. Powrót do aktywnego statusu pozostawia NULL, jeśli terminu nie było.

Karta przechodzi optymistycznie do celu; w trakcie zapisu kolejne ruchy są zablokowane. Błąd przywraca pozycję na podstawie danych serwera i pokazuje polski komunikat. Sukces odświeża Pipeline i unieważnia cache Follow-upów/Kalendarza. Nie zmieniono ich interfejsu, formularza dodawania, panelu edycji, bazy, migracji, Auth ani RLS.

Pliki: `pipeline-board.tsx` (sensory, stan ruchu i zapis), `pipeline-column.tsx` (cel), `draggable-lead-card.tsx` (źródło), `lead-card.tsx` (podłączenie interakcji do istniejącego przycisku), `pipeline-drag.ts` (kolizje i kroki klawiatury), `lib/leads/move.ts` (typy i walidacja), `actions/leads.ts` (wąska aktualizacja). Zaktualizowano testy Pipeline/panelu i dodano `tests/drag-lead.test.mjs`.

Testy zakończone poprawnie: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` — **138/138** (18 nowych i 120 wcześniejszych). Nowe testy sprawdzają 49 par statusów, brak zbędnego UPDATE, zachowanie danych, NULL i potwierdzenie zamknięcia, filtry właściciela, konflikt równoległego zapisu, odmowę i awarię SDK, optymistyczny ruch, rollback, blokadę wysyłania, rozróżnienie kliknięcia/przeciągania, konfigurację sensorów, siedem celów klawiatury oraz wyróżnienie kart/kolumn. Wszystkie rekordy SDK i aktualizacje w tych testach są lokalnymi atrapami, bez połączeń do bazy.

W Safari potwierdzono zwykłe otwarcie panelu, chwycenie spacją, przejście do ostatniej kolumny z automatycznym przewijaniem, podświetlenie celu, Escape i przywrócenie widoczności/fokusu karty. Nie upuszczano kart do innego statusu i nie zmieniano danych klientów.

Ręczny odbiór na środowisku testowym lub przy świadomej zmianie własnego leada:

1. Przeciągnij kartę do innego aktywnego statusu, sprawdź nową kolumnę i odśwież stronę. Zweryfikuj zachowanie pozostałych pól.
2. Przenieś leada z terminem do won/lost. Odmowa potwierdzenia ma pozostawić status i termin; potwierdzenie ma zapisać status oraz NULL i wykluczyć termin z Follow-upów/Kalendarza. Powrót do aktywnego statusu nie przywraca starej daty.
3. Sprawdź na fizycznym telefonie przewijanie palcem, przytrzymanie, upuszczanie oraz otwieranie karty krótkim tapnięciem. Podgląd responsywny nie zastępuje testu rzeczywistych zdarzeń dotykowych.
4. Sprawdź rzeczywistą awarię zapisu i ochronę RLS innym kontem. Testy lokalne filtrów/rollbacku nie potwierdzają zdalnych polityk ani rzeczywistego zapisu.

## Kalendarz follow-upów — etap 6

`/calendar` pokazuje bieżący miesiąc według Europe/Warsaw, z polskimi nazwami i tygodniem od poniedziałku. Dostępne są poprzedni/następny miesiąc, Dziś oraz prosty widok tygodniowy. Na komputerze każdy dzień pokazuje do dwóch klientów i przycisk rozwijający pozostałych. Nazwy i kolorowe paski korzystają z obecnego `statuses.ts`; kliknięcie otwiera istniejący `LeadPanel`. Na telefonie siatka pokazuje liczbę kontaktów, a pod nią znajduje się lista klientów z wybranego dnia. Nawigacja klawiaturą obsługuje strzałki, Home/End i Page Up/Down; panel zachowuje własne Escape i ostrzeżenie o niezapisanych zmianach.

Kalendarz korzysta z **tego samego `getFollowUpLeads()` co Follow-upy**: SSR, zweryfikowana tożsamość, filtr właściciela i pięciu aktywnych statusów, RLS oraz paginacja. Nowy parametr określa tylko adres powrotu po zalogowaniu (`/calendar` albo dotychczasowy `/follow-ups`). Daty są grupowane jako `YYYY-MM-DD`, bez konwersji DATE na lokalną chwilę UTC. `won`, `lost` i puste terminy są pomijane. Zmiana `follow_up_date` przenosi wpis do właściwego dnia; NULL usuwa go z kalendarza, ale aktywny klient pozostaje w sekcji Bez terminu na Follow-upach.

Po dodaniu/edycji leada lub zmianie terminu przez Wykonano/Przełóż unieważniane są wszystkie trzy widoki. Istniejący panel wykonuje `router.refresh()` na bieżącej trasie, dzięki czemu kalendarz aktualizuje się po zapisie i zachowuje wybrany zakres. Nie powstał drugi panel, nowa tabela, migracja, historia ani zależności. Kod widoków Pipeline i Follow-upy pozostał bez przebudowy.

Pliki etapu: `src/lib/leads/calendar.ts` (siatka, daty, grupowanie), `src/components/calendar/follow-up-calendar-view.tsx` (widok miesiąca/tygodnia i lista dnia), `src/app/(crm)/calendar/page.tsx` (SSR i błąd odczytu). Minimalne uzupełnienia wspólnego zapytania oraz invalidacji cache znajdują się w `follow-up-queries.ts`, `actions/leads.ts` i `actions/follow-ups.ts`. Zaktualizowano testy invalidacji trzech widoków i dodano `tests/calendar.test.mjs`.

Testy etapu 6 zakończone poprawnie: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` — **117/117** (19 nowych testów Kalendarza i 98 wcześniejszych). Nowe 19 testów obejmuje siatki 4/5/6 tygodni, poniedziałki, zmianę miesiąca/roku, lata przestępne i stulecia, DST i cztery strefy czasowe, zgodność terminów z Follow-upami, wykluczanie zamkniętych leadów, NULL, rozwijanie wpisów, listę dnia, istniejący panel, zmianę daty po odświeżeniu danych, klawiaturę, błędy i ochronę odczytu. Testy używają danych w pamięci i atrap SDK/React; nie potwierdzają rzeczywistego zapisu ani międzykontowego RLS.

Ręczny odbiór na własnych, rzeczywistych danych lub w środowisku testowym:

1. Ustal termin istniejącego leada w panelu. Sprawdź ten sam dzień w Follow-upach i Kalendarzu.
2. Kliknij nazwę w Kalendarzu, zmień datę i zapisz. Wpis powinien zniknąć ze starego dnia i pojawić się w nowym, bez przeładowania strony; wybrany miesiąc/tydzień pozostaje.
3. Wyczyść termin: wpis znika z kalendarza, a aktywny lead trafia do Bez terminu w Follow-upach. Zamknięcie jako won/lost wyklucza go z obu list zaplanowanych kontaktów.
4. Sprawdź wiele rzeczywistych terminów jednego dnia, rozwijanie i otwieranie klienta z mobilnej listy dnia. Nie twórz fikcyjnych klientów w produkcji.
5. Sprawdź odmowę dostępu z innego konta i zachowanie przy rzeczywistym błędzie zapisu. Istniejące testy lokalne filtrów i błędów nie zastępują testów zdalnych polityk.

W Safari sprawdzono rzeczywisty odczyt pustego kalendarza, przejście do stycznia kolejnego roku, Dziś, przełącznik tygodnia oraz siatkę i zmianę wybranego dnia przy szerokości 375 px. W chwili sprawdzania istniejące leady nie miały zaplanowanych terminów, więc rzeczywiste otwieranie/zapis z pozycji kalendarza i listy z wieloma klientami wymagają ręcznego odbioru. Nie zmieniano zdalnych danych ani migracji.

## Follow-upy — etap 5

`/follow-ups` odczytuje aktywne leady z Supabase SSR i pokazuje cztery sekcje z licznikami: Zaległe, Na dziś, Nadchodzące i Bez terminu. `won`/`lost` są wykluczone w zapytaniu i grupowaniu. Terminy DATE są porównywane jako daty kalendarzowe Europe/Warsaw; szybkie opcje również korzystają z tej strefy, niezależnie od strefy przeglądarki. Otwarta strona aktualizuje podział po zmianie dnia (co 30 sekund i po powrocie do karty), bez zmieniania danych leada.

`FollowUpsList` renderuje karty, przyciski i istniejący `LeadPanel`. `FollowUpDialog` otwiera mały formularz z opcjami Dziś, Jutro, +3 dni, +7 dni, Bez terminu oraz istniejącym `FollowUpCalendar`. Modal obsługuje Escape, fokus, blokadę wielokrotnego zapisu i zachowanie daty po błędzie. Kalendarz przyjmuje opcjonalną datę „dzisiaj”, więc w Follow-upach używa Warszawy; dotychczasowe wywołania w Pipeline zachowują swoje działanie.

Server Action `saveFollowUp()` weryfikuje użytkownika przez istniejący `getAuthenticatedClaims()`, waliduje UUID, działanie i datę. Jeden UPDATE z filtrami `id`, `user_id` i aktywnego statusu atomowo zapisuje `follow_up_date` oraz serwerowe `last_contact_at` dla **Wykonano**. **Przełóż** zapisuje wyłącznie `follow_up_date`. Brak terminu zapisuje NULL. Nie ma operacji na `lead_activities`. Zamknięcie leada równocześnie w innym oknie blokuje zapis follow-upu. Po zapisie odświeżane są Follow-upy i Pipeline; zapis w istniejącym panelu także unieważnia oba widoki.

Nie ma nowych migracji, zmian Auth/RLS, zależności, historii kontaktów ani zmian widoku Kalendarz. Panel korzysta z kolumny `notes` dodanej w etapie 4C.

Weryfikacja zakończona poprawnie: `npm run lint`, `npm run build`, `node --test tests/*.test.mjs` — **98/98 testów** (23 nowe testy Follow-upów i 75 wcześniejszych). Nowy `tests/follow-ups.test.mjs` sprawdza grupowanie, sortowanie, północ w Warszawie, DST, granice miesiąca/roku, NULL, wykluczenie zamkniętych leadów, filtry właściciela, paginację, atomowy payload, brak zmiany czasu przy przełożeniu, błędy, ponowienie, blokadę zapisu, kalendarz i obsługę okien. Są to lokalne testy z atrapami SDK/React, a nie testy rzeczywistego RLS.

Ręczny odbiór zapisu (na środowisku testowym lub świadomie wybranym własnym leadzie):

1. Wybierz **Wykonano → Jutro → Potwierdź wykonanie**. Sprawdź przeniesienie do Nadchodzących i nowy czas ostatniego kontaktu w panelu.
2. Wykonaj kontakt z **Bez terminu**. Sprawdź sekcję Bez terminu, NULL daty i nowy czas kontaktu.
3. Wybierz **Przełóż**, ustaw datę i zapisz. Termin powinien się zmienić, a `last_contact_at` pozostać identyczny.
4. Otwórz klienta, zmień następny krok lub termin i zapisz. Karta powinna się odświeżyć. Po zmianie statusu na won/lost lead znika z Follow-upów, a termin jest NULL.
5. Sprawdź zachowanie po błędzie sieci, utracie sesji oraz RLS przy innym rzeczywistym koncie. Testy lokalne sprawdzają filtry i obsługę odmowy, ale nie zastępują testów zdalnych polityk.

W ramach etapu 5 nie zapisywano ani nie tworzono zdalnych rekordów testowych. Rzeczywisty odczyt i otwieranie panelu sprawdzono w zalogowanym Safari, a formularze terminów i kalendarz także przy szerokości 375 px. Rzeczywisty zapis i międzykontowe testy RLS pozostają do ręcznego odbioru.

## Baza danych — bieżący stan

Tabele `leads` i `lead_activities` oraz RLS pochodzą z etapu 2B; użytkownik potwierdził wcześniejsze testy struktury i dostępu. Historyczne migracje 2B i 3B pozostają bez zmian. Panel wymaga kolumny `leads.notes` dodawanej migracją 4C. W etapie 5 potwierdzono jej odczyt w panelu; nie wykonywano zdalnych migracji ani audytu historii CLI. Niewdrożona migracja 4B znajduje się poza aktywnym katalogiem, w `supabase/archive/4b/`. Instrukcja wdrożenia 4C jest w [supabase/README.md](supabase/README.md#etap-4c--opcjonalne-notatki-leada).

## Pipeline — etap 3A

`/pipeline` pokazuje Kanban: siedem kolumn, statusowe kolory, liczniki oraz karty rzeczywistych leadów. `src/lib/leads/statuses.ts` jest wspólnym źródłem nazw, wartości statusów i dokładnych kolorów. `PipelineBoard` grupuje rekordy, `PipelineColumn` renderuje kolumnę i stan pusty, a `LeadCard` pokazuje pola rekordu.

`getPipelineLeads()` pobiera dane po stronie serwera przez istniejącego klienta Supabase SSR. Przed zapytaniem weryfikuje tożsamość istniejącym `getAuthenticatedClaims()`, wybiera wyłącznie pola potrzebne karcie i filtruje `user_id` po zweryfikowanym `sub`. RLS pozostaje dodatkową warstwą ochrony. Odczyt jest dzielony na zakresy z licznikiem `exact`, aby limit odpowiedzi API nie ucinał wyników; błąd dowolnego zakresu odrzuca cały niepełny wynik. Nie dodano nowych bibliotek.

Aktywne kolumny są sortowane od najwcześniejszej daty follow-upu, z rekordami bez terminu na końcu; przy równych datach kolejność wyznacza ID. Kontakt wybierany jest kolejno z Instagrama, e-maila i telefonu. Puste pola są pomijane, a wartość `0` pozostaje widoczna. Orientacyjne wartości są prezentowane w PLN. Daty porównywane są jako DATE, z bieżącym dniem w strefie Europe/Warsaw; zaległy termin ma czerwone oznaczenie i tekst „Zaległy”.

Pusty wynik nadal renderuje wszystkie siedem kolumn z zerami i krótką informacją. Błąd pobierania pokazuje osobny komunikat oraz link ponowienia odczytu, zamiast pustych kolumn. Kolumny mają wspólną szerokość i przewijają się we własnym obszarze poziomym, dostępnym również z klawiatury. Karta bez daty pokazuje „Nie zaplanowano follow-upu” i nie jest oznaczana jako zaległa. Etap 4A dodaje panel edycji opisany poniżej. Panel po etapie 4C zawiera jedno edytowalne pole Notatki; historia aktywności jest niewidoczna. Przeciąganie między statusami dodaje etap 7 opisany powyżej.

## Szybkie dodawanie — etap 3B

Przycisk „+ Dodaj leada” otwiera modal w Pipeline. Wymagane są wyłącznie nazwa firmy i jeden kontakt: Instagram (domyślnie), e-mail albo telefon. Status domyślny to Nowy. Follow-up jest opcjonalny: Dziś, Jutro, +3 dni, +7 dni, wizualny kalendarz lub wyczyszczenie terminu. Od etapu 8B.4 szybkie terminy są obliczane według kalendarza Europe/Warsaw, niezależnie od strefy przeglądarki. Wybranie Wygrany lub Przegrany czyści datę i blokuje jej wybór; powrót do aktywnego statusu nie przywraca terminu.

`AddLeadDialog` zarządza formularzem, komunikatami i stanem zapisu. Natywny `dialog.showModal()` zapewnia modalność i ograniczenie fokusu; otwarcie ustawia fokus na nazwie, zamknięcie przywraca go przyciskowi. Escape zamyka najpierw otwarty kalendarz, następnie formularz. Podczas zapisu zamykanie i kolejne wysłanie są zablokowane. `FollowUpCalendar` obsługuje klawiaturę (strzałki, Home/End, PageUp/PageDown), miesiące i lata przestępne.

Server Action `createLead` ponownie weryfikuje tożsamość przez istniejące `getAuthenticatedClaims()`, waliduje dane i zapisuje wyłącznie dozwolone pola przez klienta SSR z RLS. Właściciel pochodzi z potwierdzonego `sub`, nigdy z formularza. Pozostałe dwa kontakty i pusty termin są zapisywane jako NULL. Błąd zachowuje cały formularz; sukces zamyka modal, pokazuje komunikat i odświeża Pipeline przez `revalidatePath` oraz `router.refresh()`. Rozpoznawany jest również błąd starego ograniczenia daty.

**Przed użyciem formularza zastosuj `20261117000100_optional_active_follow_up.sql`.** Nie zmieniono historycznej migracji, polityk RLS, logowania ani plików środowiskowych.

## Karta leada i edycja — etap 4A

Kliknięcie karty lub Enter/Spacja po jej zaznaczeniu otwiera jeden panel po prawej stronie Pipeline. Na komputerze ma maksymalnie 36 rem szerokości; na telefonie wypełnia dostępną szerokość. Nagłówek i przycisk zapisu pozostają widoczne, a zawartość przewija się wewnątrz panelu. Natywny dialog ogranicza fokus do panelu. Escape zamyka najpierw kalendarz, a następnie panel; po zamknięciu fokus wraca do karty, również gdy zmieniła kolumnę.

Panel edytuje nazwę, trzy kontakty, status, usługę, wartość PLN, follow-up, następny krok i Notatki (po uproszczeniu w etapie 4C). Daty dodania i ostatniego kontaktu są tylko do odczytu (druga pojawia się, jeśli istnieje). Wymagane są nazwa i co najmniej jeden kontakt. Status zawsze pochodzi z siedmiu istniejących opcji. Pozostałe dane można wyczyścić. Kwota przyjmuje przecinek lub kropkę, zero oraz maksymalnie dwa miejsca dziesiętne; musi mieścić się w NUMERIC(12,2) i być nieujemna. Terminy wykorzystują istniejący `FollowUpCalendar` i lokalne operacje na datach; `won`/`lost` czyszczą termin.

`PipelineBoard` przechowuje wyłącznie wybór otwartego leada. Karty nie pobierają osobno danych; szczegóły są odczytywane na żądanie przez `getLeadDetails`. Server Action `updateLead` weryfikuje tożsamość przez istniejące `getAuthenticatedClaims()` i wykonuje UPDATE z oboma filtrami `id` oraz `user_id`. Używa klienta SSR i istniejących RLS. Payload jest konstruowany z jawnej listy edytowalnych pól; przesłane `id`, `user_id`, `created_at`, `last_contact_at` i `updated_at` nie są zapisywane. Brak dostępnego rekordu nie jest traktowany jako sukces. Pola opcjonalne bez wartości trafiają do bazy jako NULL.

Po zapisie panel pozostaje otwarty, pokazuje potwierdzenie i przyjmuje dane zwrócone z bazy jako nowy stan zapisany. `revalidatePath` i `router.refresh()` odświeżają karty, kolumny i ich liczniki. Błąd nie usuwa wpisanych danych; zapis można ponowić. W trakcie zapisu kontrolki, kolejne wysłanie i zamykanie są zablokowane. Zamknięcie z niezapisanymi zmianami wymaga potwierdzenia ich odrzucenia. Przeglądarka ostrzega również przy odświeżeniu lub zamknięciu karty z takimi zmianami.

Nie zmieniono bazy, RLS, logowania, formularza dodawania, widoków Follow-upy/Kalendarz ani zależności. Edycja bez terminu zakłada zastosowanie wcześniejszej migracji 3B; jej brak daje czytelny komunikat. Nie dodano usuwania ani nowych tras. Bieżące notatki są polem leada, a historia aktywności pozostaje poza interfejsem.

### Weryfikacja etapu 4A

W etapie 4A zestaw testów obejmował 56 testów: 18 edycji, 15 dodawania, 11 Pipeline i 12 Auth. Nowe testy sprawdzają walidację i wszystkie pola, siedem statusów, opcjonalność, wartości PLN, jawny payload bez pól chronionych, filtry właściciela, zerową aktualizację niedostępnego rekordu, błędy, zachowanie danych po błędzie, ponowienie, brak wielokrotnego zapisu, kalendarz, ostrzeżenie przed utratą zmian, odświeżenie Pipeline i powrót fokusu po zmianie kolumny. Używają atrap SDK, hooków React i DOM; nie wysyłają żądań do Supabase. Nie są pełnym testem RLS ani natywnego dialogu w przeglądarce.

Do ręcznego odbioru po `npm run dev` i zalogowaniu:

1. Otwórz istniejącą kartę kliknięciem oraz klawiaturą. Sprawdź poprawne uzupełnienie wszystkich danych, datę dodania i ostatni kontakt, jeśli istnieje.
2. Zmień pola, zapisz i sprawdź komunikat oraz kartę w Pipeline. Zmiana statusu ma przenieść ją do właściwej kolumny. Zamknij i otwórz ponownie, a następnie odśwież stronę — dane powinny pozostać zapisane.
3. Sprawdź pustą nazwę, brak wszystkich kontaktów, błędny e-mail, ujemną lub zbyt dużą kwotę. Dane po błędzie powinny pozostać. Zweryfikuj też kwotę zero i wyczyszczenie pól opcjonalnych.
4. Sprawdź Dziś/Jutro/+3/+7, kalendarz, wyczyszczenie terminu i oba statusy zamknięte. Powrót do aktywnego statusu nie może przywrócić daty.
5. Zmień dane i spróbuj zamknąć panel przez × oraz Escape. Anuluj ostrzeżenie, sprawdź zachowanie danych, a następnie potwierdź odrzucenie. Sprawdź Tab/Shift+Tab, klawiaturę kalendarza i powrót fokusu do karty.
6. Sprawdź panel przy szerokości 320 px, przewijanie, klawiaturę ekranową i widoczny przycisk zapisu. Na komputerze Pipeline powinien pozostać widoczny obok panelu.
7. Zweryfikuj błąd połączenia i ponowienie zapisu oraz brak regresji dodawania, nawigacji, sesji i wylogowania. Pełny test cudzych danych wymaga drugiego rzeczywistego, już istniejącego konta; nie twórz go automatycznie. Odpowiedzi SDK w testach lokalnych jedynie symulują odmowę dostępu.

Powyższe próby rzeczywistego interfejsu, zapisu i odmowy RLS nie zostały wykonane automatycznie. Nie dodano zdalnych danych testowych. Środowisko wykonawcze blokuje lokalny serwer przez `listen EPERM`.

## Poprawka dialogów po etapie 4A

W rzeczywistym Safari potwierdzono rozbieżność między CSS stosowanym przez dokument i aktualnym arkuszem serwera: stary CSSOM miał 310 reguł, świeżo pobrany i sparsowany arkusz 407. W starszej wersji brakowało m.in. `.m-auto`, paddingu formularza i `appearance-none`. To powodowało błędne położenie i wygląd formularza. Po przeładowaniu z pominięciem cache (Safari: Option+Command+R) modal jest ponownie wyśrodkowany. Nie stwierdzono błędu hydracji aplikacji podczas tej diagnostyki.

Dodatkowo uporządkowano cykl życia obu natywnych dialogów: formularz dodawania jest montowany dopiero po kliknięciu i nie występuje w początkowym HTML. Stan React kontroluje jego obecność, a efekt odpowiada za `showModal()` i fokus. Demontaż obu okien jawnie wykonuje `close()` oraz przywraca poprzedni overflow dokumentu. Formularz ma jawne `fixed inset-0`, a zamknięte dialogi są ukrywane regułą `dialog:not([open])`. Nie dodano osobnych overlayów ani zmian z-index. Logika Supabase i zapisu pozostała bez zmian.

Testy lokalne rozszerzono o brak formularza w SSR, wielokrotne otwieranie i zamykanie, Escape, demontaż i ponowne utworzenie komponentu po odświeżeniu. Po tej poprawce zestaw obejmował 58 testów. Diagnostyka Safari korzystała wyłącznie z odczytu istniejącej karty, bez zapisów do bazy. Sprawdzono zamykanie Escape i powrót fokusu, otwieranie karty po zamknięciu dodawania, odświeżenie z otwartym panelem i ponowne otwarcie karty oraz odświeżenie z otwartym dodawaniem. Mobilny wygląd nie był ponownie testowany w tej poprawce.

## Uproszczone notatki — etap 4C

W panelu pozostało jedno edytowalne pole „Notatki” zamiast pól „Potrzeby klienta”, „Obawy klienta” i sekcji historii. Pozostałe dane leada, układ bocznego panelu, kalendarz terminu i wspólny przycisk „Zapisz zmiany” działają jak wcześniej. Notes może być puste; pusty tekst i same białe znaki są zapisywane jako NULL. Odczyt uzupełnia textarea istniejącą treścią. Zapis odświeża dane Pipeline, a ponowne otwarcie panelu pobiera notatki z bazy. Błąd zachowuje szkic, a zamknięcie z niezapisanymi notatkami wymaga potwierdzenia.

`src/lib/leads/details.ts` zawiera typ, projekcję i walidację `notes`. Server Action `updateLead` zapisuje to pole wyłącznie dla zweryfikowanego właściciela z istniejącym SSR i RLS. `client_needs` i `client_concerns` usunięto nie tylko z widoku, ale również z payloadu UPDATE, aby zapis uproszczonego formularza nie zerował ich dotychczasowych wartości. Kolumny te oraz `lead_activities` i jej rekordy pozostają w bazie. Nie kopiowano automatycznie dawnych danych do nowego pola i nie zmieniano logowania ani pozostałych widoków.

**Przed użyciem panelu zastosuj `supabase/migrations/20261118000100_add_lead_notes.sql`.** Migracja dodaje tylko `notes TEXT NULL` do `public.leads`, w jednej transakcji. Nie ma zmian RLS, usuwania kolumn, aktualizacji danych ani nowych triggerów. Przy brakującej kolumnie aplikacja zwraca czytelny komunikat o migracji 4C. Migracji nie wykonano zdalnie.

Zgodnie z potwierdzeniem użytkownika migracja 4B nie została wdrożona. Przeniesiono ją bez zmiany treści do `supabase/archive/4b/migrations/20261117000200_record_lead_status_changes.sql`; zależny test SQL jest w `supabase/archive/4b/tests/activities.sql`. Archiwum znajduje się poza `supabase/migrations`, więc przyszłe `db push` nie wdroży triggera statusów. Zachowany kod aktywności i jego testy jednostkowe nie są podłączone do panelu 4C.

### Testy i wdrożenie 4C

Uruchom `npm run lint`, `npm run build` oraz `node --test tests/*.test.mjs`. Zestaw obejmuje 75 testów lokalnych. Testy edycji sprawdzają odczyt i zapis notatek, ponowny odczyt, multiline, NULL, czyszczenie, zachowanie po błędzie, ostrzeżenie o szkicu, jeden formularz i przycisk zapisu, brak dawnych pól/historii oraz zachowanie pozostałych danych. Używają atrap SDK i DOM, bez zdalnych zapisów. Zachowane jednostkowe testy kodu 4B również są uruchamiane, ale nie wdrażają SQL.

`supabase/tests/structure.sql` rozszerzono o kolumnę notes (TEXT, nullable), domyślny NULL, zapis i czyszczenie oraz zachowanie starych pól i brak tworzenia aktywności. Pozostałe kontrole pozostają. Wersja 4C skryptu jest **niewykonana**; uruchamiaj cały plik tylko na lokalnej/testowej bazie po migracji, z istniejącym kontem Auth. Skrypt kończy się ROLLBACK. Nie tworzono testowych klientów w produkcji.

Instrukcja migracji jest w [supabase/README.md](supabase/README.md#etap-4c--opcjonalne-notatki-leada). Po wdrożeniu sprawdź na istniejącym leadzie: wpisanie zamierzonych notatek, zapis, ponowne otwarcie i odświeżenie, wyczyszczenie treści, zachowanie szkicu po błędzie i ostrzeżenie przy zamykaniu. Rzeczywistego zapisu do Supabase ani pełnego testu UI nowego pola nie wykonano przed dodaniem kolumny — migracja pozostaje do świadomego zastosowania przez użytkownika.

## Widoki i nawigacja

- `/pipeline` — Kanban rzeczywistych leadów, modal dodawania i panel edycji.
- `/follow-ups` — miejsce na zaplanowane kontakty i kolejne kroki.
- `/calendar` — miejsce na spotkania i ważne terminy.
- `/login` — publiczny formularz logowania e-mail i hasłem.

Widoki CRM wymagają uwierzytelnienia. Gość trafia na `/login` z bezpiecznym parametrem powrotu `next`. Po zalogowaniu `/` prowadzi do `/pipeline`, a wejście na `/login` przekierowuje do dozwolonego widoku. Każdy widok ma własny tytuł, opis i stan pusty. Aktywna zakładka ma kontrastowe tło i `aria-current="page"`. Na telefonie wszystkie trzy zakładki pozostają widoczne w jednym rzędzie, bez dodatkowego menu. Nawigacja ma widoczny fokus klawiatury, a link „Przejdź do treści” pozwala pominąć nagłówek.

Etap 2A zapewnia logowanie i wylogowanie. Etap 3A dodaje odczyt Pipeline; widoki Follow-upy i Kalendarz pozostają bez zmian. Etap 3B dodaje wyłącznie formularz tworzenia leada; nie implementuje widoku kalendarza.

## Logowanie i ochrona tras

Formularz `/login` korzysta z Server Action `login` i `supabase.auth.signInWithPassword()`. Walidacja odbywa się na serwerze, a formularz pokazuje błędy i stan oczekiwania. Hasło nie trafia do zwracanego stanu, logów ani konfiguracji. Klient `@supabase/ssr` zapisuje sesję w cookies. Adres powrotu jest ograniczony do `/pipeline`, `/follow-ups` i `/calendar`; dowolny inny adres daje `/pipeline`.

`src/proxy.ts` uruchamia `updateSession` dla `/`, `/login` i trzech widoków CRM, także ich podścieżek. `getClaims()` weryfikuje token, a adapter `getAll`/`setAll` przekazuje odświeżone cookies do żądania i odpowiedzi. Cookies oraz nagłówki `Cache-Control`, `Expires` i `Pragma` są zachowane również przy przekierowaniu. Odpowiedzi objęte proxy nie mogą być współdzielone w cache. Błąd weryfikacji, awaria Auth albo anonimowa sesja Supabase nie otwierają dostępu do CRM.

Layout `(crm)` dodatkowo sprawdza `getClaims()` przed renderowaniem. Sama obecność cookie ani odczyt `getSession()` nie są podstawą autoryzacji. Operacje serwerowe odczytu i dodawania leadów ponawiają weryfikację; tabele i RLS przygotowano w etapie 2B.

Przycisk „Wyloguj się” w nagłówku wywołuje Server Action `logout`: `signOut({ scope: "local" })` kończy bieżącą sesję i usuwa jej cookies. Po udanym logowaniu lub wylogowaniu unieważniany jest cache layoutu i wykonywane jest przekierowanie. Przy błędzie wylogowania wyświetlany jest komunikat zamiast pozornego sukcesu. Inne urządzenia nie są wylogowywane. Jak w standardowym Supabase Auth, skopiowany wcześniej access token zachowuje ważność do czasu wygaśnięcia; wylogowanie unieważnia refresh token bieżącej sesji.

Publicznej rejestracji, odzyskiwania hasła, OAuth ani systemu ról nie zaimplementowano.

## Prywatny użytkownik w Supabase Dashboard

1. W swoim projekcie otwórz **Authentication → Sign In / Providers**. Upewnij się, że metoda Email jest włączona. Wyłącz **Allow new users to sign up** i **Allow anonymous sign-ins**, aby projekt przyjmował wyłącznie istniejące konta. Sam brak formularza rejestracji w CRM nie wyłącza API rejestracji Supabase.
2. Otwórz **Authentication → Users → Add user → Create new user**.
3. Wpisz swój adres e-mail i silne hasło. Dla własnego, ręcznie tworzonego konta zaznacz **Auto confirm user?**, ponieważ ten etap nie zawiera obsługi linków potwierdzających e-mail. Kliknij **Create user**. Jeśli konto już istnieje, użyj go zamiast tworzyć kolejne.
4. Dane konta wpisuj wyłącznie do formularza logowania. Nie umieszczaj ich w `.env.local` ani kodzie.

Nie zmieniano zdalnych ustawień projektu i nie utworzono żadnego użytkownika automatycznie. Instrukcje opierają się na [konfiguracji Auth](https://supabase.com/docs/guides/auth/general-configuration) i formularzu [CreateUserModal w oficjalnym Supabase Studio](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Auth/Users/CreateUserModal.tsx).

## Uruchomienie lokalne

Wymagany Node.js >= 22.0.0 (wymaganie zainstalowanego Supabase SDK; zalecana wspierana wersja LTS) oraz npm.

```bash
npm ci
npm run dev
```

Aplikacja będzie dostępna pod adresem http://localhost:3000.

## Weryfikacja

```bash
npm run lint
npm run build
npm run test:auth
node --test tests/*.test.mjs
```

Build sprawdza również typy TypeScript. Wersję produkcyjną po kompilacji uruchamia `npm start`.

Etap 3B: lokalne testy obejmują 15 testów dodawania, 11 testów Pipeline i 12 testów Auth. Używają danych w pamięci, atrap Supabase oraz kontrolera formularza z atrapami hooków React; nie tworzą danych zdalnych. Sprawdzają walidację, siedem statusów, właściwe kolumny kontaktu, ignorowanie przesłanego właściciela, opcjonalne daty, daty zamkniętych leadów, granice miesięcy/lat i strefy czasowe, kalendarz, czyszczenie daty, zachowanie formularza po błędzie, ponowienie, blokadę wielokrotnego wysłania oraz sukces i odświeżenie. Testy Pipeline sprawdzają też sortowanie NULL na końcu i opis braku terminu.

Nie zastępuje to testu rzeczywistego DOM, klawiatury, responsywności ani połączenia zalogowanego formularza z Supabase. Serwer w środowisku wykonawczym jest blokowany przez `listen EPERM`, a podgląd przeglądarki był niedostępny. Nie wykonano nowej migracji ani zmienionego testu SQL. Poprzednie testy struktury i RLS użytkownik potwierdził dla etapu 2B.

### Ręczny odbiór dodawania po migracji

1. Zastosuj nową migrację zgodnie z instrukcją CLI. Następnie uruchom cały zaktualizowany `supabase/tests/structure.sql` z UUID własnego konta; skrypt kończy się ROLLBACK. Pozostałe testy ograniczeń zachowano.
2. Uruchom `npm run dev`, zaloguj się i otwórz Pipeline. Kliknij „+ Dodaj leada”: fokus powinien być w nazwie. Wpisz rzeczywistego leada i jeden kontakt, pozostaw Nowy i pusty termin. Zapis ma zamknąć modal, wyświetlić sukces i kartę bez terminu bez ręcznego odświeżania.
3. Przy kolejnych zamierzonych zapisach sprawdź każdy typ kontaktu i siedem statusów. Sprawdź terminy Dziś/Jutro/+3/+7, kalendarz na granicy miesiąca i roku oraz „Wyczyść termin”. Zmiana na Wygrany/Przegrany usuwa datę; powrót do Nowy pozostawia ją pustą.
4. Wpisz puste dane lub błędny e-mail: komunikat wskazuje pole. Przerwij połączenie podczas próby zapisu: modal i dane pozostają; po przywróceniu połączenia można ponowić. Podczas oczekiwania nie da się wielokrotnie wysłać formularza.
5. Sprawdź Tab/Shift+Tab, Escape, wybór daty klawiaturą i powrót fokusu po zamknięciu. Na telefonie sprawdź przewijanie modala, widoczność kalendarza i brak poziomego przepełnienia dokumentu. Karty z datami powinny poprzedzać karty bez terminu. Zweryfikuj też nawigację, odświeżenie sesji i wylogowanie.

Powyższe próby interfejsu i rzeczywistego zapisu wymagają ręcznej weryfikacji. Nie dodano rekordów demonstracyjnych do Supabase.

W etapie 2A lint i build przeszły poprawnie. Dwanaście testów lokalnych sprawdza bezpieczne przekierowania, ochronę tras, brak pętli, cookies i nagłówki po odświeżeniu, walidację, obsługę błędnego hasła i awarii oraz akcje logowania i wylogowania. Test z rzeczywistym SDK oraz lokalnie wygenerowaną parą kluczy sprawdza odrzucenie sfałszowanego podpisu JWT. Większość odpowiedzi Auth jest zastępowana lokalnymi atrapami; żadne konto nie jest tworzone i żadne żądania nie trafiają do prawdziwego projektu.

Test produkcyjnego handlera Next.js bez otwierania portu potwierdził HTTP 200 i formularz pod `/login` oraz HTTP 307 do `/login` dla gościa pod `/`, `/pipeline`, `/follow-ups` i `/calendar`. Widoki CRM są renderowane dynamicznie. Testy te nie zastępują integracji z kontem Supabase.

### Ręczne testy z prawdziwym kontem — pozostają niewykonane

1. Uruchom `npm run dev` w lokalnym terminalu i otwórz okno prywatne przeglądarki. Wejdź na `/calendar`: oczekiwane `/login?next=%2Fcalendar`, bez pętli.
2. Wyślij pusty formularz, a następnie wpisz adres istniejącego użytkownika i błędne hasło: oczekiwane czytelne błędy, bez wejścia do CRM. W czasie żądania przycisk pokazuje „Logowanie…”.
3. Zaloguj się prawidłowo: oczekiwany powrót do `/calendar`. Wejście bez parametru `next` powinno prowadzić do `/pipeline`.
4. Odśwież stronę i przejdź między trzema zakładkami: sesja pozostaje aktywna. Wejście na `/login` ma przekierować do CRM. Odśwież również po wygaśnięciu access tokena, aby sprawdzić rzeczywiste odnowienie przez refresh token.
5. Kliknij „Wyloguj się”: oczekiwane `/login`. Sprawdź wszystkie chronione adresy i przycisk Wstecz, następnie odśwież: CRM pozostaje niedostępny.
6. Sprawdź logowanie i nagłówek na telefonie, np. przy szerokości 320 px, oraz obsługę klawiaturą.

Nie mam danych logowania do istniejącego konta; nie wykonywano powyższych prób na prawdziwej usłudze i nie utworzono konta testowego.

Kompilacja korzysta z Webpacka, ponieważ środowisko wykonawcze blokuje otwieranie lokalnych portów wymaganych przez Turbopack przy przetwarzaniu CSS. To ograniczenie blokowało również próbę startu serwera developerskiego (`listen EPERM`); jego działanie wymaga sprawdzenia w zwykłym terminalu lokalnym.

## Struktura

```text
src/
├── app/
│   ├── globals.css      # Tailwind CSS i globalne style
│   ├── layout.tsx       # Główny layout, metadane, lang="pl"
│   ├── page.tsx         # Przekierowanie do /pipeline
│   ├── login/page.tsx   # Formularz i sprawdzenie istniejącej sesji
│   ├── actions/auth.ts # Server Actions logowania i wylogowania
│   ├── actions/leads.ts # Odczyt, tworzenie i edycja leada
│   ├── actions/activities.ts # Zachowany, niepodłączony kod 4B
│   └── (crm)/
│       ├── layout.tsx   # Wspólny nagłówek, nawigacja i main
│       ├── pipeline/page.tsx
│       ├── follow-ups/page.tsx
│       └── calendar/page.tsx
├── components/
│   ├── app-navigation.tsx # Linki Next.js, aktywna zakładka
│   ├── login-form.tsx     # Pola, błędy, stan ładowania
│   ├── logout-button.tsx  # Wylogowanie i jego wynik
│   ├── section-view.tsx   # Wspólny nagłówek widoku i stan pusty
│   ├── section-icon.tsx   # Niewielkie ikony SVG
│   └── pipeline/
│       ├── lead-activities.tsx # Zachowany, niepodłączony kod 4B
│       ├── lead-panel.tsx
│       ├── add-lead-dialog.tsx
│       ├── follow-up-calendar.tsx
│       ├── pipeline-board.tsx
│       ├── pipeline-column.tsx
│       └── lead-card.tsx
├── lib/
│   ├── auth/
│   │   ├── redirect.ts # Dozwolone adresy powrotu
│   │   └── session.ts  # Serwerowa weryfikacja claims
│   ├── leads/
│   │   ├── statuses.ts # Statusy i kolory
│   │   ├── create.ts   # Walidacja i stan formularza
│   │   ├── details.ts  # Typy szczegółów i walidacja edycji
│   │   ├── activities.ts # Typy i pomocniki zachowanego kodu 4B
│   │   ├── dates.ts    # Lokalny kalendarz i operacje na datach
│   │   ├── pipeline.ts # Typ projekcji, grupowanie i formatowanie
│   │   └── queries.ts  # Odczyt SSR z filtrem właściciela
│   └── supabase/
│       ├── client.ts   # Klient do komponentów przeglądarkowych
│       ├── server.ts   # Klient do kodu serwerowego, cookies żądania
│       ├── proxy.ts    # Odświeżanie sesji i ochrona tras
│       └── env.ts      # Wspólna walidacja konfiguracji
└── proxy.ts            # Punkt wejścia proxy Next.js 16

tests/auth.test.mjs     # Lokalne testy bezpieczeństwa i akcji
tests/pipeline.test.mjs # Lokalne testy Kanbana i odczytu
tests/create-lead.test.mjs # Walidacja, daty, Server Action i kontroler formularza
tests/edit-lead.test.mjs   # Aktualizacja, własność, panel i niezapisane zmiany
tests/activities.test.mjs  # Historia, kontakt, ponowienia i kontroler wpisów
```

Konfiguracja projektu znajduje się w katalogu głównym. Alias `@/*` wskazuje na `src/*`. TypeScript działa w trybie `strict`. Tailwind CSS 4 używa integracji PostCSS i nie wymaga pliku `tailwind.config.ts`.

Grupa tras `(crm)` współdzieli chroniony layout i nie zmienia adresów URL. Komponenty klienckie obsługują aktywną nawigację i stan formularzy. Layout oraz strony pozostają komponentami serwerowymi. Nie dodano zależności.

## Konfiguracja Supabase

Konfiguracja znajduje się w `.env.local` w katalogu głównym. Jeśli przygotowujesz nową kopię projektu, skopiuj pusty `.env.example` do `.env.local` bez nadpisywania istniejącej konfiguracji.

W panelu swojego projektu Supabase otwórz **Connect** i skopiuj **Project URL** oraz **Publishable Key**. Wklej je po znakach `=` w `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Użyj Publishable Key zaczynającego się od `sb_publishable_`. Plik `.env.local` jest ignorowany przez Git, a pusty `.env.example` można wersjonować. Zmienne `NEXT_PUBLIC_*` są dostępne w przeglądarce. Po uzupełnieniu lub zmianie wartości uruchom ponownie serwer developerski; dla wersji produkcyjnej wykonaj ponownie build.

W Client Components importuj `createClient` z `@/lib/supabase/client` i wywołuj `createClient()`. W Server Components, Server Actions i Route Handlers importuj funkcję z `@/lib/supabase/server` i wywołuj `await createClient()`. Klient serwerowy powstaje osobno dla każdego wywołania i używa asynchronicznego `cookies()` oraz metod `getAll`/`setAll`. W Server Components zapis cookies jest niedostępny.

Konfiguracja jest sprawdzana przy tworzeniu klienta: brak wartości, niepoprawny URL albo niewłaściwy typ klucza powodują błąd bez ujawniania wartości. Logowanie i ochrona tras wymagają poprawnego URL oraz Publishable Key. Pliki środowiskowe pozostawiono bez zmian.

Klienty i proxy korzystają z cookie-based SSR zgodnie z [dokumentacją Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client). Pipeline korzysta z istniejących polityk RLS tabeli `leads`.

W etapie 3A nie zmieniano tabel, migracji ani uprawnień. Rzeczywisty odczyt z aplikacji wymaga zalogowanej sesji; testy lokalne nie potwierdzają jeszcze integracji z prawdziwymi rekordami.

## Wersje zależności

Projekt zainicjalizowano na Next.js 16.2.12 i React 19.2.4 dostępnych w lokalnym cache npm. Dostęp terminala do rejestru npm był niedostępny (błąd DNS), więc nie udało się pobrać najnowszych stabilnych wersji. Dokładne zainstalowane wersje zapisuje `package-lock.json`.

W etapie 1B dodano wyłącznie `@supabase/supabase-js` 2.110.9 i `@supabase/ssr` 0.10.3 oraz ich zależności pośrednie. Biblioteki zainstalowano z lokalnego cache npm z powodu tego samego ograniczenia dostępu do sieci.
