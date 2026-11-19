type FormState = { dirty: boolean; blocked: boolean };
const forms = new Set<FormState>();
let removeBeforeUnload: (() => void) | undefined;

export function confirmDiscardChanges(dirty: boolean, blocked = false, reason = "") {
  if (blocked) return false;
  return !dirty || window.confirm(
    `${reason || "Masz niezapisane zmiany."}\n\nOK — Odrzuć zmiany.\nAnuluj — Pozostań i kontynuuj edycję.`,
  );
}

export function confirmNavigation() {
  const current = Array.from(forms);
  return confirmDiscardChanges(
    current.some((form) => form.dirty),
    current.some((form) => form.blocked),
  );
}

export function registerUnsavedChanges(form: FormState) {
  forms.add(form);
  if (!removeBeforeUnload) {
    const warn = (event: BeforeUnloadEvent) => {
      if (!Array.from(forms).some((entry) => entry.dirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    removeBeforeUnload = () => window.removeEventListener("beforeunload", warn);
  }
  return () => {
    forms.delete(form);
    if (!forms.size) {
      removeBeforeUnload?.();
      removeBeforeUnload = undefined;
    }
  };
}

type Entry = { index: number; key: string };
type NavigationApi = EventTarget & {
  currentEntry: Entry | null;
  traverseTo(key: string): { finished: Promise<unknown> };
};
const historyIndexKey = "__crmHistoryIndex";

// Instancja żyje w głównym layoucie, również podczas przejść między trasami.
export function installNavigationGuard(host: Window = window) {
  const navigation = (host as Window & { navigation?: NavigationApi }).navigation;
  const modern = navigation?.currentEntry && typeof navigation.traverseTo === "function"
    ? navigation
    : undefined;
  const originalPush = host.history.pushState;
  const originalReplace = host.history.replaceState;
  const indexOf = (state: Record<string, unknown> | null) =>
    typeof state?.[historyIndexKey] === "number" ? state[historyIndexKey] as number : null;
  let index = modern?.currentEntry?.index ?? indexOf(host.history.state) ?? 0;
  let entryKey = modern?.currentEntry?.key;
  let restoring = false;
  let active = true;

  function rememberEntry(event: Event) {
    if ((event as Event & { navigationType?: string }).navigationType === "traverse") return;
    if (modern?.currentEntry) {
      index = modern.currentEntry.index;
      entryKey = modern.currentEntry.key;
    }
  }

  function pushState(data: Record<string, unknown> | null, unused: string, url?: string | URL | null) {
    if (!active) return originalPush.call(host.history, data, unused, url);
    const next = index + 1;
    originalPush.call(host.history, { ...data, [historyIndexKey]: next }, unused, url);
    index = next;
  }
  function replaceState(data: Record<string, unknown> | null, unused: string, url?: string | URL | null) {
    return originalReplace.call(host.history, active ? { ...data, [historyIndexKey]: index } : data, unused, url);
  }

  function restore(target: number) {
    restoring = true;
    if (modern && entryKey) {
      // Cel jest konkretnym istniejącym wpisem, także przy szybkich kliknięciach.
      void modern.traverseTo(entryKey).finished.catch(() => {});
    } else {
      host.history.go(index - target);
    }
  }

  function onPopState(event: PopStateEvent) {
    const target = modern?.currentEntry?.index ?? indexOf(event.state);
    // Wpisy spoza dokumentu są chronione przez natywne beforeunload.
    if (target === null || target === undefined) return;
    if (restoring) {
      event.stopImmediatePropagation();
      if (target === index) restoring = false;
      else restore(target);
      return;
    }
    if (target === index) return;
    if (!confirmNavigation()) {
      // Capture zatrzymuje obsługę Next.js przed unmountem formularza.
      event.stopImmediatePropagation();
      restore(target);
      return;
    }
    index = target;
    entryKey = modern?.currentEntry?.key;
  }

  if (modern) {
    modern.addEventListener("currententrychange", rememberEntry);
  } else {
    // Starsze przeglądarki: oznaczamy wyłącznie rzeczywiste wpisy. Nie dodajemy
    // żadnego wpisu strażnika i nie nadpisujemy pól stanu należących do Next.js.
    originalReplace.call(host.history, { ...host.history.state, [historyIndexKey]: index }, "");
    host.history.pushState = pushState;
    host.history.replaceState = replaceState;
  }
  host.addEventListener("popstate", onPopState, true);
  host.addEventListener("pageshow", rememberEntry);
  return () => {
    active = false;
    modern?.removeEventListener("currententrychange", rememberEntry);
    host.removeEventListener("popstate", onPopState, true);
    host.removeEventListener("pageshow", rememberEntry);
    if (host.history.pushState === pushState) host.history.pushState = originalPush;
    if (host.history.replaceState === replaceState) host.history.replaceState = originalReplace;
  };
}
