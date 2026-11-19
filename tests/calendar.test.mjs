import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadModule(relative, mocks = {}, globals = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(
    code,
    {
      module: moduleObject,
      exports: moduleObject.exports,
      ...globals,
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith("@/")) {
          const base = "src/" + name.slice(2);
          return loadModule(
            [base + ".ts", base + ".tsx"].find((file) =>
              fs.existsSync(path.join(root, file)),
            ),
            mocks,
            globals,
            cache,
          );
        }
        return require(name);
      },
    },
    { filename },
  );
  return moduleObject.exports;
}

const calendar = loadModule("src/lib/leads/calendar.ts");
const dates = loadModule("src/lib/leads/dates.ts");
const followUps = loadModule("src/lib/leads/follow-ups.ts");
const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const leadId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
function lead(overrides = {}) {
  return {
    id: leadId,
    updated_at: "2026-11-19T12:00:00.123456+00:00",
    company_name: "Klient",
    status: "new",
    follow_up_date: "2026-11-18",
    next_step: null,
    ...overrides,
  };
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

test("miesiąc zaczyna siatkę od poniedziałku, obejmuje pełne tygodnie i wszystkie dni", () => {
  const cases = [
    ["2026-11-18", "2026-10-26", 30, 42],
    ["2027-02-18", "2027-02-01", 28, 28],
    ["2028-02-18", "2028-01-31", 29, 35],
    ["2026-12-18", "2026-11-30", 31, 35],
  ];
  for (const [anchor, monday, length, cells] of cases) {
    const days = calendar.getCalendarDays(anchor, "month");
    assert.equal(days[0].value, monday);
    assert.equal(dates.parseLocalDate(days[0].value).getDay(), 1);
    assert.equal(days.length, cells);
    assert.deepEqual(
      Array.from(
        days.filter((d) => d.inMonth),
        (d) => d.day,
      ),
      Array.from({ length }, (_, i) => i + 1),
    );
  }
});
test("lata przestępne i wyjątki stuleci nie tworzą brakujących ani dodatkowych dni", () => {
  for (const [year, expected] of [
    [1900, 28],
    [2000, 29],
    [2027, 28],
    [2028, 29],
    [2100, 28],
  ]) {
    const days = calendar
      .getCalendarDays(`${year}-02-15`, "month")
      .filter((d) => d.inMonth);
    assert.equal(days.length, expected);
    assert.equal(days.at(-1).value, `${year}-02-${expected}`);
  }
});
test("miesiące i tygodnie przechodzą przez granice roku bez przepełnienia dat", () => {
  assert.equal(
    calendar.moveCalendarAnchor("2026-12-31", "month", 1),
    "2027-01-01",
  );
  assert.equal(
    calendar.moveCalendarAnchor("2027-01-31", "month", -1),
    "2026-12-01",
  );
  assert.equal(
    calendar.moveCalendarAnchor("2028-01-31", "month", 1),
    "2028-02-01",
  );
  assert.equal(
    calendar.moveCalendarAnchor("2026-12-31", "week", 1),
    "2027-01-07",
  );
  assert.equal(
    calendar.moveCalendarAnchor("2027-01-01", "week", -1),
    "2026-12-25",
  );
  assert.equal(calendar.moveCalendarAnchor("0001-01-01", "month", -1), null);
  assert.equal(calendar.moveCalendarAnchor("9999-12-01", "month", 1), null);
});
test("tydzień obejmuje poniedziałek–niedzielę także na przełomie miesiąca i roku", () => {
  const days = calendar.getCalendarDays("2027-01-01", "week");
  assert.deepEqual(
    Array.from(days, (d) => d.value),
    [
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ],
  );
});
test("daty DATE nie przesuwają się przy innej strefie przeglądarki ani zmianie czasu", () => {
  const original = process.env.TZ;
  try {
    for (const zone of [
      "Europe/Warsaw",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Pacific/Kiritimati",
    ]) {
      process.env.TZ = zone;
      for (const anchor of [
        "2026-03-29",
        "2026-10-25",
        "2028-02-29",
        "2026-12-31",
      ]) {
        const days = calendar.getCalendarDays(anchor, "month");
        assert.equal(days.filter((d) => d.value === anchor).length, 1);
        assert.equal(dates.parseLocalDate(days[0].value).getDay(), 1);
      }
      assert.equal(
        calendar.moveCalendarAnchor("2026-03-29", "week", 1),
        "2026-04-05",
      );
      assert.ok(
        calendar.calendarDayLabel("2028-02-29").includes("29 lutego 2028"),
      );
      assert.equal(calendar.calendarMonthLabel("2026-11-18"), "listopad 2026");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test("Kalendarz zawiera dokładnie zaplanowane terminy Follow-upów, w tej samej kolejności", () => {
  const rows = [
    lead({ id: "z" }),
    lead({ id: "a" }),
    lead({ id: "old", follow_up_date: "2026-11-01" }),
    lead({ id: "future", follow_up_date: "2027-01-01" }),
    lead({ id: "unscheduled", follow_up_date: null }),
    lead({ id: "won", status: "won", follow_up_date: null }),
    lead({ id: "lost", status: "lost", follow_up_date: "2026-11-18" }),
  ];
  const snapshot = JSON.stringify(rows);
  const byDate = calendar.groupCalendarLeads(rows);
  const grouped = followUps.groupFollowUps(rows, "2026-11-18");
  const scheduled = grouped
    .filter((g) => g.key !== "unscheduled")
    .flatMap((g) => Array.from(g.leads));
  assert.deepEqual(
    Array.from(byDate.values())
      .flatMap((entries) => Array.from(entries, (l) => l.id))
      .sort(),
    Array.from(scheduled, (l) => l.id).sort(),
  );
  assert.deepEqual(
    Array.from(byDate.get("2026-11-18"), (l) => l.id),
    ["a", "z"],
  );
  assert.equal(JSON.stringify(rows), snapshot);
  assert.equal(
    calendar.groupCalendarLeads([lead({ follow_up_date: "invalid" })]).size,
    0,
  );
});
test("zmiana daty przenosi kontakt, NULL lub zamknięcie usuwa go z kalendarza", () => {
  const before = calendar.groupCalendarLeads([lead()]);
  const after = calendar.groupCalendarLeads([
    lead({ follow_up_date: "2027-01-01" }),
  ]);
  assert.equal(before.get("2026-11-18").length, 1);
  assert.equal(after.has("2026-11-18"), false);
  assert.equal(after.get("2027-01-01").length, 1);
  for (const values of [
    { follow_up_date: null },
    { status: "won" },
    { status: "lost" },
  ])
    assert.equal(calendar.groupCalendarLeads([lead(values)]).size, 0);
});

function uiHarness({
  rows = [lead()],
  initialToday = "2026-11-18",
  now = "2026-11-18T12:00:00Z",
} = {}) {
  const React = require("react"),
    hooks = [],
    effects = [],
    frames = [],
    listeners = new Map();
  let cursor = 0,
    tree,
    focused,
    interval,
    instant = now;
  let anchor = initialToday, view = "month", pending = false, nextUrl, ok = true;
  const requests = [];
  let deferred = false;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
  }
  const fakeDocument = {
    getElementById(id) {
      return nodes(tree).some((n) => n.props?.id === id)
        ? {
            focus() {
              focused = id;
            },
          }
        : null;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const fakeWindow = {
    setInterval(fn) {
      interval = fn;
      return 1;
    },
    clearInterval() {
      interval = null;
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const react = {
    ...React,
    useTransition: () => [pending, (callback) => callback()],
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks))
        hooks[i] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[i],
        (value) => {
          hooks[i] = typeof value === "function" ? value(hooks[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: initial };
      return hooks[i];
    },
    useEffect(callback, deps) {
      const i = cursor++,
        previous = hooks[i];
      if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) {
        hooks[i] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          hooks[i].cleanup?.();
          hooks[i].cleanup = callback();
        });
      }
    },
  };
  const { FollowUpCalendarView } = loadModule(
    "src/components/calendar/follow-up-calendar-view.tsx",
    {
      react,
      "@/app/actions/leads": {},
      "next/navigation": { useRouter: () => ({
        replace(url) {
          requests.push(url);
          if (deferred) {
            pending = true;
            nextUrl = url;
          } else applyRange(url);
        },
        refresh() { requests.push("refresh"); },
      }) },
    },
    {
      Date: Clock,
      window: fakeWindow,
      document: fakeDocument,
      requestAnimationFrame(fn) {
        frames.push(fn);
      },
    },
  );
  function applyRange(url) {
    const params = new URL(url, "https://crm.test").searchParams;
    anchor = params.get("date");
    view = params.get("view");
  }
  function render(nextRows = rows) {
    rows = nextRows;
    cursor = 0;
    tree = FollowUpCalendarView({
      result: ok ? { ok: true, leads: rows } : { ok: false },
      initialToday, anchor, view, days: calendar.getCalendarDays(anchor, view),
    });
    nodes(tree).find((n) => n.props?.ref).props.ref.current = {
      focus() {
        focused = "calendar";
      },
    };
    effects.splice(0).forEach((fn) => fn());
    return tree;
  }
  const find = (fn) => nodes(tree).find(fn);
  function click(label) {
    find(
      (n) => n.type === "button" && n.props.children === label,
    ).props.onClick();
    render();
  }
  function clickId(id) {
    find((n) => n.props?.id === id).props.onClick();
    render();
  }
  render();
  return {
    render,
    find,
    click,
    clickId,
    listeners,
    requests,
    deferNavigation() { deferred = true; },
    resolveNavigation(success) {
      applyRange(nextUrl);
      pending = false;
      ok = success;
      return render();
    },
    go(label) {
      find((n) => n.props?.["aria-label"] === label).props.onClick();
      render();
    },
    key(id, key) {
      let prevented = false;
      find((n) => n.props?.id === id).props.onKeyDown({
        key,
        preventDefault() {
          prevented = true;
        },
      });
      render();
      frames.splice(0).forEach((fn) => fn());
      return prevented;
    },
    flush() {
      frames.splice(0).forEach((fn) => fn());
    },
    setNow(value) {
      instant = value;
      interval?.();
      render();
    },
    unmount() {
      hooks.forEach((h) => h?.cleanup?.());
    },
    get focused() {
      return focused;
    },
    get interval() {
      return interval;
    },
  };
}
function dayEntries(ui, date) {
  return nodes(ui.find((n) => n.props?.["data-date"] === date)).filter(
    (n) => n.type?.name === "CalendarLead",
  );
}

test("pusty kalendarz pokazuje bieżący miesiąc, polskie dni i stany puste, bez otwartego panelu", () => {
  const ui = uiHarness({ rows: [] });
  const html = renderToStaticMarkup(ui.render());
  for (const text of [
    "listopad 2026",
    "Pon",
    "Niedz",
    "Brak zaplanowanych kontaktów w tym miesiącu.",
    "Brak zaplanowanych kontaktów w wybranym dniu.",
    "Europe/Warsaw",
  ])
    assert.ok(html.includes(text));
  assert.equal((html.match(/data-date=/g) ?? []).length, 42);
  assert.equal(html.includes('aria-haspopup="dialog"'), false);
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  assert.equal(
    ui.find((n) => n.props?.id === "calendar-day-2026-11-18").props[
      "aria-current"
    ],
    "date",
  );
  assert.ok(ui.interval);
  ui.unmount();
  assert.equal(ui.interval, null);
  assert.equal(ui.listeners.size, 0);
});
test("domyślny miesiąc i Dziś wynikają z dnia w Warszawie, również po północy UTC", () => {
  const ui = uiHarness({
    rows: [],
    initialToday: "2027-01-01",
    now: "2026-12-31T23:30:00Z",
  });
  assert.ok(renderToStaticMarkup(ui.render()).includes("styczeń 2027"));
  ui.go("Poprzedni miesiąc");
  assert.ok(renderToStaticMarkup(ui.render()).includes("grudzień 2026"));
  ui.click("Dziś");
  assert.equal(
    ui.find((n) => n.props?.id === "calendar-day-2027-01-01").props[
      "aria-pressed"
    ],
    true,
  );
  ui.setNow("2027-01-01T23:30:00Z");
  assert.equal(
    ui.find((n) => n.props?.id === "calendar-day-2027-01-02").props[
      "aria-current"
    ],
    "date",
  );
  ui.unmount();
});
test("nawigacja miesiąc/tydzień i Dziś zachowują wybór oraz poprawnie przechodzą do kolejnego roku", () => {
  const ui = uiHarness({
    initialToday: "2026-12-31",
    now: "2026-12-31T12:00:00Z",
  });
  ui.go("Następny miesiąc");
  assert.ok(renderToStaticMarkup(ui.render()).includes("styczeń 2027"));
  ui.go("Poprzedni miesiąc");
  assert.ok(renderToStaticMarkup(ui.render()).includes("grudzień 2026"));
  ui.click("Dziś");
  ui.click("Tydzień");
  assert.equal(
    nodes(ui.render()).filter((n) => n.props?.["data-date"]).length,
    7,
  );
  ui.go("Następny tydzień");
  assert.equal(
    ui.find((n) => n.props?.id === "calendar-day-2027-01-07").props[
      "aria-pressed"
    ],
    true,
  );
  ui.click("Miesiąc");
  assert.ok(renderToStaticMarkup(ui.render()).includes("styczeń 2027"));
  ui.unmount();
});
test("klienci są we właściwych dniach, z dotychczasowymi kolorami wszystkich aktywnych statusów", () => {
  const rows = LEAD_STATUSES.map((s, i) =>
    lead({
      id: String(i),
      company_name: `Firma ${i}`,
      status: s.value,
      follow_up_date: `2026-11-${18 + i}`,
    }),
  );
  rows.push(
    lead({
      id: "unscheduled",
      company_name: "Bez terminu",
      follow_up_date: null,
    }),
  );
  const ui = uiHarness({ rows });
  const html = renderToStaticMarkup(ui.render());
  for (const [i, status] of LEAD_STATUSES.entries()) {
    if (["won", "lost"].includes(status.value)) {
      assert.equal(html.includes(`Firma ${i}`), false);
      continue;
    }
    assert.equal(
      dayEntries(ui, `2026-11-${18 + i}`)[0].props.lead.id,
      String(i),
    );
    assert.ok(html.includes(`border-left-color:${status.color}`));
    assert.ok(html.includes(`style="color:${status.textColor}"`));
  }
  assert.equal(html.includes("Otwórz klienta: Bez terminu"), false);
  ui.unmount();
});
test("dużo kontaktów ma podgląd, rozwijanie i zwijanie bez utraty wpisów", () => {
  const rows = Array.from({ length: 7 }, (_, i) =>
    lead({ id: String(i), company_name: `Firma ${i}` }),
  );
  const ui = uiHarness({ rows });
  assert.equal(dayEntries(ui, "2026-11-18").length, 2);
  ui.click("Pokaż pozostałe (5)");
  assert.equal(dayEntries(ui, "2026-11-18").length, 7);
  assert.equal(
    nodes(ui.find((n) => n.props?.id === "calendar-events-2026-11-18")).filter(
      (n) => n.type?.name === "CalendarLead",
    ).length,
    7,
  );
  ui.click("Zwiń listę");
  assert.equal(dayEntries(ui, "2026-11-18").length, 2);
  ui.unmount();
});
test("na telefonie wybór dnia udostępnia listę klientów z tego dnia oraz pusty stan", () => {
  const ui = uiHarness({ rows: [lead({ follow_up_date: "2026-11-20" })] });
  ui.clickId("calendar-day-2026-11-20");
  let agenda = ui.find(
    (n) =>
      n.type === "section" &&
      n.props["aria-labelledby"] === "calendar-selected-title",
  );
  assert.equal(
    nodes(agenda).find((n) => n.type?.name === "CalendarLead").props.lead.id,
    leadId,
  );
  assert.ok(agenda.props.className.includes("sm:hidden"));
  ui.clickId("calendar-day-2026-11-21");
  agenda = ui.find(
    (n) =>
      n.type === "section" &&
      n.props["aria-labelledby"] === "calendar-selected-title",
  );
  assert.equal(
    nodes(agenda).some((n) => n.type?.name === "CalendarLead"),
    false,
  );
  assert.ok(
    renderToStaticMarkup(ui.render()).includes(
      "Brak zaplanowanych kontaktów w wybranym dniu.",
    ),
  );
  ui.unmount();
});
test("kliknięcie nazwy otwiera istniejący panel; po zmianie daty można zamknąć i ponownie otworzyć", () => {
  const ui = uiHarness();
  const entry = dayEntries(ui, "2026-11-18")[0];
  entry.props.onOpen(entry.props.lead, entry.props.id);
  ui.render();
  let panel = ui.find((n) => n.type?.name === "LeadPanel");
  assert.equal(panel.props.leadId, leadId);
  assert.equal(
    nodes(ui.render()).filter((n) => n.type?.name === "LeadPanel").length,
    1,
  );
  ui.render([
    lead({ follow_up_date: "2026-11-20", company_name: "Zapisana nazwa" }),
  ]);
  assert.equal(dayEntries(ui, "2026-11-18").length, 0);
  assert.equal(
    dayEntries(ui, "2026-11-20")[0].props.lead.company_name,
    "Zapisana nazwa",
  );
  panel.props.onClose();
  ui.render();
  ui.flush();
  assert.equal(ui.focused, "calendar-day-2026-11-18");
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  const next = dayEntries(ui, "2026-11-20")[0];
  next.props.onOpen(next.props.lead, next.props.id);
  ui.render();
  panel = ui.find((n) => n.type?.name === "LeadPanel");
  assert.equal(panel.props.companyName, "Zapisana nazwa");
  ui.render([lead({ status: "won", follow_up_date: null })]);
  assert.equal(dayEntries(ui, "2026-11-20").length, 0);
  ui.unmount();
});
test("zamknięcie panelu bez zmian przywraca fokus na nazwę klienta", () => {
  const ui = uiHarness();
  const entry = dayEntries(ui, "2026-11-18")[0];
  entry.props.onOpen(entry.props.lead, entry.props.id);
  ui.render();
  ui.find((n) => n.type?.name === "LeadPanel").props.onClose();
  ui.render();
  ui.flush();
  assert.equal(ui.focused, entry.props.id);
  ui.unmount();
});
test("strzałki i Page Up/Down przechodzą między dniami i miesiącami, utrzymując fokus", () => {
  const ui = uiHarness({
    initialToday: "2026-12-31",
    now: "2026-12-31T12:00:00Z",
  });
  assert.equal(ui.key("calendar-day-2026-12-31", "ArrowRight"), true);
  assert.equal(ui.focused, "calendar-day-2027-01-01");
  assert.equal(ui.key("calendar-day-2027-01-01", "PageDown"), true);
  assert.equal(ui.focused, "calendar-day-2027-02-01");
  assert.ok(renderToStaticMarkup(ui.render()).includes("luty 2027"));
  assert.equal(ui.key("calendar-day-2027-02-01", "Escape"), false);
  ui.unmount();
});

test("strona pobiera zakres siatki bieżącego miesiąca w Warszawie lub wybranego tygodnia", async () => {
  const requested = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ["2026-12-31T23:01:00Z"])); }
  }
  const result = { ok: true, leads: [] };
  const { default: Page } = loadModule("src/app/(crm)/calendar/page.tsx", {
    "@/lib/leads/follow-up-queries": {
      async getFollowUpLeads(...args) {
        requested.push(args);
        return result;
      },
    },
  }, { Date: Clock });
  for (const [params, from, to] of [
    [{}, "2026-12-28", "2027-01-31"],
    [{ date: "2026-11-18", view: "month" }, "2026-10-26", "2026-12-06"],
    [{ date: "2027-01-01", view: "week" }, "2026-12-28", "2027-01-03"],
    [{ date: "2028-02-29", view: "week" }, "2028-02-28", "2028-03-05"],
    [{ date: ["2027-01-01"], view: "invalid" }, "2026-12-28", "2027-01-31"],
    [{ date: "2026-02-30" }, "2026-12-28", "2027-01-31"],
  ]) {
    const tree = await Page({ searchParams: Promise.resolve(params) });
    const view = nodes(tree).find((n) => n.type?.name === "FollowUpCalendarView");
    assert.equal(view.props.result, result);
    assert.equal(view.props.days[0].value, from);
    assert.equal(view.props.days.at(-1).value, to);
    const [route, range] = requested.pop();
    assert.equal(route, "/calendar");
    assert.equal(range.from, from);
    assert.equal(range.to, to);
    assert.equal(requested.length, 0);
  }
});
test("brak tożsamości chroni odczyt Kalendarza i zachowuje właściwy adres powrotu", async () => {
  let connections = 0;
  const { getFollowUpLeads } = loadModule(
    "src/lib/leads/follow-up-queries.ts",
    {
      "@/lib/auth/session": { getAuthenticatedClaims: async () => null },
      "@/lib/supabase/server": {
        createClient: async () => {
          connections++;
        },
      },
      "next/navigation": {
        redirect(path) {
          throw Error(`REDIRECT:${path}`);
        },
      },
    },
  );
  await assert.rejects(
    getFollowUpLeads("/calendar", { from: "2026-11-16", to: "2026-11-22" }),
    /REDIRECT:\/login\?next=%2Fcalendar/,
  );
  assert.equal(connections, 0);
});
test("odczyt Kalendarza filtruje obie granice w Supabase i zachowuje filtry właściciela oraz statusu", async () => {
  const calls = [],
    sdk = {};
  for (const name of ["schema", "from", "select", "eq", "in", "gte", "lte", "order", "range"])
    sdk[name] = (...args) => {
      calls.push([name, ...args]);
      return sdk;
    };
  let rows = [lead({ follow_up_date: "2026-11-16" }), lead({ follow_up_date: "2026-11-22" })];
  sdk.overrideTypes = async () => ({ data: rows, error: null, count: rows.length });
  const { getFollowUpLeads } = loadModule(
    "src/lib/leads/follow-up-queries.ts",
    {
      "@/lib/auth/session": {
        getAuthenticatedClaims: async () => ({ sub: owner }),
      },
      "@/lib/supabase/server": { createClient: async () => sdk },
    },
  );
  const range = { from: "2026-11-16", to: "2026-11-22" };
  const result = await getFollowUpLeads("/calendar", range);
  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.filter(([name]) => name === "eq"),
    [["eq", "user_id", owner]],
  );
  assert.deepEqual(
    Array.from(calls.find(([name]) => name === "in")[2]),
    Array.from(followUps.ACTIVE_LEAD_STATUSES),
  );
  assert.deepEqual(
    calls.filter(([name]) => name === "from"),
    [["from", "leads"]],
  );
  assert.deepEqual(calls.filter(([name]) => ["gte", "lte"].includes(name)), [
    ["gte", "follow_up_date", range.from], ["lte", "follow_up_date", range.to],
  ]);
  for (const values of [{ follow_up_date: null }, { follow_up_date: "2026-11-15" },
    { follow_up_date: "2026-11-23" }, { status: "won" }, { status: "lost" }]) {
    rows = [lead(values)];
    assert.equal((await getFollowUpLeads("/calendar", range)).ok, false);
  }
});

test("wybór dnia pozostaje lokalny, oczekiwanie blokuje drugi odczyt, a ponowienie zachowuje zakres", () => {
  const ui = uiHarness();
  ui.clickId("calendar-day-2026-11-19");
  ui.click("Miesiąc");
  ui.click("Dziś");
  assert.deepEqual(ui.requests, []);
  ui.deferNavigation();
  ui.click("Tydzień");
  ui.go("Następny miesiąc");
  assert.deepEqual(ui.requests, ["/calendar?view=week&date=2026-11-18"]);
  assert.match(renderToStaticMarkup(ui.render()), /Ładowanie kalendarza/);
  const failed = renderToStaticMarkup(ui.resolveNavigation(false));
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /Brak zaplanowanych kontaktów|Kontakty: 0/);
  assert.equal(nodes(ui.render()).filter((n) => n.props?.["data-date"]).length, 7);
  ui.click("Spróbuj ponownie");
  assert.deepEqual(ui.requests, ["/calendar?view=week&date=2026-11-18", "refresh"]);
  ui.unmount();
});

test("nowe dane serwerowe po edycji zachowują wybrany tydzień i otwarty panel", () => {
  const ui = uiHarness();
  ui.click("Tydzień");
  const entry = dayEntries(ui, "2026-11-18")[0];
  entry.props.onOpen(entry.props.lead, entry.props.id);
  ui.render([lead({ follow_up_date: "2026-11-22" })]);
  assert.equal(dayEntries(ui, "2026-11-18").length, 0);
  assert.equal(dayEntries(ui, "2026-11-22").length, 1);
  const html = renderToStaticMarkup(ui.render([]));
  assert.equal(dayEntries(ui, "2026-11-22").length, 0);
  assert.match(html, /Brak zaplanowanych kontaktów w tym tygodniu/);
  assert.equal(ui.find((n) => n.type?.name === "LeadPanel").props.leadId, leadId);
  assert.deepEqual(ui.requests, ["/calendar?view=week&date=2026-11-18"]);
  ui.unmount();
});
