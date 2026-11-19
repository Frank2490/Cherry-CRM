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

const logic = loadModule("src/lib/leads/follow-ups.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const leadId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const version = "2026-11-19T12:00:00.123456+00:00";
function lead(overrides = {}) {
  return {
    id: leadId,
    updated_at: version,
    company_name: "Klient",
    status: "new",
    follow_up_date: "2026-11-18",
    next_step: null,
    ...overrides,
  };
}
function form(mode = "complete", date = "") {
  const data = new FormData();
  data.set("mode", mode);
  data.set("expected_updated_at", version);
  data.set("follow_up_date", date);
  data.set("user_id", "forged-owner");
  data.set("last_contact_at", "2000-01-01");
  data.set("status", "won");
  return data;
}

test("cztery sekcje grupują daty, sortują chronologicznie i wykluczają won/lost", () => {
  const rows = [
    lead({ id: "later", follow_up_date: "2027-01-01" }),
    lead({ id: "nearer", follow_up_date: "2026-11-19" }),
    lead(),
    lead({ id: "overdue-later", follow_up_date: "2026-11-17" }),
    lead({ id: "overdue-first", follow_up_date: "2026-10-01" }),
    lead({ id: "empty", follow_up_date: null }),
    lead({ status: "won", follow_up_date: null }),
    lead({ status: "lost" }),
  ];
  const snapshot = JSON.stringify(rows);
  const groups = logic.groupFollowUps(rows, "2026-11-18");
  assert.deepEqual(
    Array.from(groups, (g) => Array.from(g.leads, (l) => l.id)),
    [
      ["overdue-first", "overdue-later"],
      [leadId],
      ["nearer", "later"],
      ["empty"],
    ],
  );
  assert.equal(JSON.stringify(rows), snapshot);
  assert.equal(logic.ACTIVE_LEAD_STATUSES.length, 5);
});
test("niewykonany kontakt następnego dnia staje się zaległy, bez zmiany rekordu", () => {
  const row = lead();
  assert.equal(logic.groupFollowUps([row], "2026-11-18")[1].leads.length, 1);
  assert.equal(logic.groupFollowUps([row], "2026-11-19")[0].leads.length, 1);
  assert.equal(row.follow_up_date, "2026-11-18");
});
test("szybkie terminy korzystają z Warszawy przy północy, DST i zmianie miesiąca/roku", () => {
  const cases = [
    [
      "2026-12-31T23:30:00Z",
      ["2027-01-01", "2027-01-02", "2027-01-04", "2027-01-08"],
    ],
    [
      "2028-02-28T23:30:00Z",
      ["2028-02-29", "2028-03-01", "2028-03-03", "2028-03-07"],
    ],
    [
      "2026-03-28T23:30:00Z",
      ["2026-03-29", "2026-03-30", "2026-04-01", "2026-04-05"],
    ],
    [
      "2026-10-24T22:30:00Z",
      ["2026-10-25", "2026-10-26", "2026-10-28", "2026-11-01"],
    ],
  ];
  for (const [instant, expected] of cases)
    assert.deepEqual(
      [0, 1, 3, 7].map((days) =>
        logic.followUpQuickDate(days, new Date(instant)),
      ),
      expected,
    );
});
test("walidacja akceptuje NULL, poprawną datę i wyłącznie dwa działania", () => {
  for (const mode of ["complete", "reschedule"]) {
    assert.equal(logic.validateFollowUp(form(mode)).date, null);
    assert.equal(
      logic.validateFollowUp(form(mode, " 2028-02-29 ")).date,
      "2028-02-29",
    );
    for (const date of [
      "2026-02-29",
      "2026-04-31",
      "invalid",
      "2026-11-18T00:00:00Z",
    ])
      assert.equal(logic.validateFollowUp(form(mode, date)).ok, false);
  }
  assert.equal(logic.validateFollowUp(form("delete")).ok, false);
  const missing = form();
  missing.delete("follow_up_date");
  assert.equal(logic.validateFollowUp(missing).ok, false);
});

function sdkHarness({
  claims = { sub: owner },
  responses = [{ data: { id: leadId }, error: null }],
  cacheError = false,
} = {}) {
  const calls = [],
    paths = [];
  let index = 0;
  const builder = {};
  for (const name of [
    "schema",
    "from",
    "select",
    "eq",
    "in",
    "order",
    "range",
    "update",
    "maybeSingle",
  ])
    builder[name] = (...args) => {
      calls.push([name, ...args]);
      return builder;
    };
  builder.overrideTypes = async () => {
    const response = responses[Math.min(index++, responses.length - 1)];
    if (response instanceof Error) throw response;
    return response;
  };
  const mocks = {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
    "@/lib/supabase/server": { createClient: async () => builder },
    "next/cache": {
      revalidatePath(path) {
        paths.push(path);
        if (cacheError) throw Error("cache");
      },
    },
    "next/navigation": {
      redirect(path) {
        throw Error(`REDIRECT:${path}`);
      },
    },
  };
  return {
    calls,
    paths,
    ...loadModule("src/app/actions/follow-ups.ts", mocks),
    ...loadModule("src/lib/leads/follow-up-queries.ts", mocks),
  };
}
test("Wykonano zapisuje datę i czas serwera atomowo, bez historii i pól z formularza", async () => {
  for (const date of ["2026-12-01", ""]) {
    const api = sdkHarness();
    const start = Date.now();
    assert.equal(
      (await api.saveFollowUp(leadId, form("complete", date))).ok,
      true,
    );
    const updates = api.calls.filter(([name]) => name === "update");
    assert.equal(updates.length, 1);
    const payload = updates[0][1];
    assert.deepEqual(Object.keys(payload).sort(), [
      "follow_up_date",
      "last_contact_at",
    ]);
    assert.equal(payload.follow_up_date, date || null);
    assert.ok(
      Date.parse(payload.last_contact_at) >= start &&
        Date.parse(payload.last_contact_at) <= Date.now(),
    );
    assert.deepEqual(
      api.calls.filter(([name]) => name === "eq"),
      [
        ["eq", "id", leadId],
        ["eq", "user_id", owner],
        ["eq", "updated_at", version],
      ],
    );
    assert.deepEqual(
      Array.from(api.calls.find(([name]) => name === "in")[2]),
      Array.from(logic.ACTIVE_LEAD_STATUSES),
    );
    assert.deepEqual(
      api.calls.filter(([name]) => name === "from"),
      [["from", "leads"]],
    );
    assert.deepEqual(api.paths, ["/follow-ups", "/pipeline", "/calendar"]);
  }
});
test("Przełóż zmienia wyłącznie termin, również na NULL", async () => {
  for (const date of ["2026-12-01", ""]) {
    const api = sdkHarness();
    assert.equal(
      (await api.saveFollowUp(leadId, form("reschedule", date))).ok,
      true,
    );
    assert.equal(
      JSON.stringify(api.calls.find(([name]) => name === "update")[1]),
      JSON.stringify({ follow_up_date: date || null }),
    );
  }
});
test("brak sesji, niepoprawne ID i dane blokują zapis przed zapytaniem", async () => {
  for (const [options, id, data] of [
    [{ claims: null }, leadId, form()],
    [{}, "wrong", form()],
    [{}, leadId, form("delete")],
    [{}, leadId, form("complete", "invalid")],
  ]) {
    const api = sdkHarness(options);
    assert.equal((await api.saveFollowUp(id, data)).ok, false);
    assert.equal(api.calls.length, 0);
  }
});
test("błędy SDK, odmowa RLS i zamknięty/cudzy lead nie zgłaszają sukcesu ani nie odświeżają cache", async () => {
  for (const response of [
    { data: null, error: { code: "42501" } },
    { data: null, error: null },
    Error("network"),
  ]) {
    const api = sdkHarness({ responses: [response] });
    const result = await api.saveFollowUp(leadId, form());
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 0);
    assert.equal(api.paths.length, 0);
  }
});
test("błąd cache po zapisie nie sugeruje ponownego wykonania kontaktu", async () => {
  const api = sdkHarness({ cacheError: true });
  assert.equal((await api.saveFollowUp(leadId, form())).ok, true);
  assert.deepEqual(api.paths, ["/follow-ups", "/pipeline", "/calendar"]);
});
test("odczyt wymaga sesji i przekierowuje do logowania", async () => {
  const api = sdkHarness({ claims: null });
  await assert.rejects(
    api.getFollowUpLeads(),
    /REDIRECT:\/login\?next=%2Ffollow-ups/,
  );
  assert.equal(api.calls.length, 0);
});
test("odczyt filtruje właściciela i statusy oraz pobiera wszystkie strony chronologicznie", async () => {
  const first = Array.from({ length: 500 }, (_, i) => lead({ id: String(i) }));
  const api = sdkHarness({
    responses: [
      { data: first, count: 501, error: null },
      { data: [lead()], count: 501, error: null },
    ],
  });
  const result = await api.getFollowUpLeads();
  assert.equal(result.ok, true);
  assert.equal(result.leads.length, 501);
  assert.deepEqual(
    api.calls.filter(([name]) => name === "range"),
    [
      ["range", 0, 499],
      ["range", 500, 999],
    ],
  );
  assert.ok(
    api.calls
      .filter(([name]) => name === "eq")
      .every((call) => call[1] === "user_id" && call[2] === owner),
  );
  const projection = api.calls.find(([name]) => name === "select")[1];
  assert.equal(
    projection,
    "id, updated_at, company_name, status, follow_up_date, next_step",
  );
  assert.ok(
    api.calls.some(
      ([name, column, options]) =>
        name === "order" &&
        column === "follow_up_date" &&
        options.ascending &&
        !options.nullsFirst,
    ),
  );
});
test("błąd pobierania nie staje się pustym lub częściowym wynikiem", async () => {
  const bad = [
    { data: null, error: { code: "network" }, count: null },
    { data: [], error: null, count: 1 },
    { data: [lead({ status: "won" })], error: null, count: 1 },
    { data: [lead({ follow_up_date: "invalid" })], error: null, count: 1 },
    Error("network"),
  ];
  for (const response of bad)
    assert.equal(
      (await sdkHarness({ responses: [response] }).getFollowUpLeads()).ok,
      false,
    );
  const partial = sdkHarness({
    responses: [{ data: [lead()], error: null, count: 2 }, bad[0]],
  });
  assert.equal((await partial.getFollowUpLeads()).ok, false);
  const empty = await sdkHarness({
    responses: [{ data: [], count: 0, error: null }],
  }).getFollowUpLeads();
  assert.equal(empty.ok, true);
  assert.equal(empty.leads.length, 0);
});

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function uiHarness(
  kind,
  {
    write = async () => ({ ok: true }),
    read = async () => ({ ok: true, lead: lead() }),
    confirmation = false,
    rows = [lead()],
    mode = "complete",
    now = "2026-11-18T12:00:00Z",
  } = {},
) {
  const React = require("react");
  const hooks = [],
    effects = [],
    tasks = [],
    frames = [],
    listeners = new Map();
  let cursor = 0,
    tree,
    saved = 0,
    closed = 0,
    refreshed = 0,
    focused,
    confirms = 0,
    timeout;
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  const fakeDocument = {
    body: { style: { overflow: "auto" } },
    getElementById(id) {
      return {
        focus() {
          focused = id;
        },
      };
    },
    addEventListener(name, fn) {
      listeners.set(name, fn);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  const fakeWindow = {
    confirm() {
      confirms++;
      return confirmation;
    },
    setTimeout(fn) {
      timeout = fn;
      return 1;
    },
    clearTimeout() {
      timeout = null;
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
    useState(value) {
      const i = cursor++;
      if (!(i in hooks))
        hooks[i] = typeof value === "function" ? value() : value;
      return [
        hooks[i],
        (next) => {
          hooks[i] = typeof next === "function" ? next(hooks[i]) : next;
        },
      ];
    },
    useRef(value) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: value };
      return hooks[i];
    },
    useEffect(callback, deps) {
      const i = cursor++,
        old = hooks[i];
      if (!old || deps.some((x, j) => !Object.is(x, old.deps[j]))) {
        hooks[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => {
          hooks[i].cleanup?.();
          hooks[i].cleanup = callback();
        });
      }
    },
    useTransition() {
      const [pending, set] = react.useState(false);
      return [
        pending,
        (callback) => {
          set(true);
          tasks.push(
            (async () => {
              try {
                await callback();
              } finally {
                set(false);
              }
            })(),
          );
        },
      ];
    },
  };
  const mocks = {
    react,
    "@/app/actions/follow-ups": { saveFollowUp: write },
    "@/app/actions/leads": { getLeadDetails: read },
    "next/navigation": {
      useRouter: () => ({
        refresh() {
          refreshed++;
        },
      }),
    },
  };
  const file =
    kind === "dialog"
      ? "src/components/follow-ups/follow-up-dialog.tsx"
      : "src/components/follow-ups/follow-ups-list.tsx";
  let instant = now;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
  }
  const exports = loadModule(file, mocks, {
    Date: Clock,
    document: fakeDocument,
    window: fakeWindow,
    FormData,
    requestAnimationFrame(callback) {
      frames.push(callback);
    },
  });
  function render(nextRows = rows) {
    rows = nextRows;
    cursor = 0;
    tree =
      kind === "dialog"
        ? exports.FollowUpDialog({
            lead: lead(),
            mode,
            onClose() {
              closed++;
            },
            onSaved() {
              saved++;
            },
          })
        : exports.FollowUpsList({ leads: rows, initialToday: "2026-11-18" });
    for (const node of nodes(tree))
      if (node.props?.ref)
        node.props.ref.current =
          node.type === "dialog"
            ? dialog
            : {
                focus() {
                  focused = node.props.id ?? node.props["aria-label"] ?? "list";
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
  render();
  return {
    render,
    find,
    click,
    dialog,
    listeners,
    setNow(value) {
      instant = value;
      timeout?.();
      render();
    },
    submit() {
      find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
      render();
    },
    async settle() {
      await Promise.allSettled(tasks);
      render();
      frames.splice(0).forEach((fn) => fn());
    },
    unmount() {
      hooks.forEach((h) => h?.cleanup?.());
    },
    confirm(value) {
      confirmation = value;
    },
    get confirms() {
      return confirms;
    },
    get saved() {
      return saved;
    },
    get closed() {
      return closed;
    },
    get refreshed() {
      return refreshed;
    },
    get focused() {
      return focused;
    },
    get timeout() {
      return timeout;
    },
    get overflow() {
      return fakeDocument.body.style.overflow;
    },
  };
}

test("pusty widok ma cztery sekcje i liczniki; zamknięte okna nie tworzą warstw", () => {
  const ui = uiHarness("list", { rows: [] });
  const html = renderToStaticMarkup(ui.render());
  assert.equal((html.match(/<h2\b/g) ?? []).length, 4);
  assert.equal((html.match(/Liczba leadów: 0/g) ?? []).length, 4);
  assert.equal(html.includes("<dialog"), false);
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  assert.ok(ui.timeout);
  assert.ok(ui.listeners.has("focus"));
  ui.unmount();
  assert.equal(ui.timeout, null);
  assert.equal(ui.listeners.size, 0);
});
test("karty mają właściwe kolory, opcjonalny następny krok, brak terminu i trzy działania", () => {
  const ui = uiHarness("list", {
    rows: [
      lead({ next_step: "Omówić ofertę", follow_up_date: null }),
      lead({ id: "second", status: "proposal", follow_up_date: "2026-11-01" }),
      lead({ status: "won" }),
      lead({ status: "lost" }),
    ],
  });
  const html = renderToStaticMarkup(ui.render());
  assert.equal((html.match(/<article\b/g) ?? []).length, 2);
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 6);
  for (const text of [
    "Omówić ofertę",
    "Nie zaplanowano follow-upu",
    "Zaległy",
    "border-left-color:#ea580c",
    "color:#c2410c;border-color:#ea580c",
    "flex-wrap",
    "min-w-0",
  ])
    assert.ok(html.includes(text));
  assert.equal(html.includes("Wygrany"), false);
  ui.unmount();
});
test("Otwórz klienta używa istniejącego panelu, zamknięcie przywraca fokus i pozwala ponownie otworzyć", () => {
  const ui = uiHarness("list");
  ui.click("Otwórz klienta");
  const panel = ui.find((n) => n.type?.name === "LeadPanel");
  assert.equal(panel.props.leadId, leadId);
  panel.props.onClose();
  ui.render();
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  ui.click("Otwórz klienta");
  assert.ok(ui.find((n) => n.type?.name === "LeadPanel"));
  ui.unmount();
});
test("po Wykonano/Przełóż okno znika, widok się odświeża i lead trafia do właściwej sekcji", () => {
  for (const [label, date, section] of [
    ["Wykonano", "2026-12-01", "upcoming"],
    ["Wykonano", null, "unscheduled"],
    ["Przełóż", "2026-11-18", "today"],
  ]) {
    const ui = uiHarness("list");
    ui.click(label);
    ui.find((n) => n.type?.name === "FollowUpDialog").props.onSaved();
    const tree = ui.render([lead({ follow_up_date: date })]);
    assert.equal(
      ui.find((n) => n.type?.name === "FollowUpDialog"),
      undefined,
    );
    assert.equal(ui.refreshed, 1);
    assert.ok(ui.find((n) => n.props?.role === "status"));
    const sec = nodes(tree).find(
      (n) =>
        n.type === "section" &&
        n.props["aria-labelledby"] === `follow-ups-${section}`,
    );
    assert.equal(nodes(sec).filter((n) => n.type === "article").length, 1);
    ui.unmount();
  }
});
test("szybkie daty, kalendarz i Bez terminu zapisują wybraną wartość", async () => {
  let submitted;
  const ui = uiHarness("dialog", {
    write: async (id, data) => {
      assert.equal(id, leadId);
      submitted = Object.fromEntries(data);
      return { ok: true };
    },
  });
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.overflow, "hidden");
  for (const [label, days] of [
    ["Dziś", 0],
    ["Jutro", 1],
    ["+3 dni", 3],
    ["+7 dni", 7],
  ]) {
    ui.click(label);
    assert.equal(
      ui.find((n) => n.type === "button" && n.props.children === label).props[
        "aria-pressed"
      ],
      true,
    );
    assert.ok(renderToStaticMarkup(ui.render()).includes("Wybrany termin"));
    assert.match(logic.followUpQuickDate(days), /^\d{4}-\d{2}-\d{2}$/);
  }
  ui.click("Wybierz datę");
  ui.find((n) => n.type?.name === "FollowUpCalendar").props.onSelect(
    "2027-01-01",
  );
  ui.render();
  ui.submit();
  await ui.settle();
  assert.equal(submitted.follow_up_date, "2027-01-01");
  assert.equal(submitted.expected_updated_at, version);
  assert.equal(ui.saved, 1);
  ui.click("Bez terminu");
  ui.submit();
  await ui.settle();
  assert.equal(submitted.follow_up_date, "");
  ui.unmount();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.overflow, "auto");
});

test("Wykonano i Przełóż zachowują wybór po konflikcie i odświeżają wersję tylko po zgodzie", async () => {
  const freshVersion = "2026-11-19T12:00:00.123457+00:00";
  for (const mode of ["complete", "reschedule"]) {
    let reads = 0;
    const writes = [];
    const ui = uiHarness("dialog", {
      mode,
      read: async () => {
        reads++;
        return { ok: true, lead: lead({ updated_at: freshVersion, follow_up_date: "2026-12-31" }) };
      },
      write: async (_id, data) => {
        writes.push(Object.fromEntries(data));
        return writes.length === 1 ? { ok: false, conflict: true, message: "Konflikt danych" } : { ok: true };
      },
    });
    ui.click("Jutro");
    ui.submit();
    await ui.settle();
    assert.equal(writes[0].expected_updated_at, version);
    assert.equal(ui.find((n) => n.type === "button" && n.props.children === "Jutro").props["aria-pressed"], true);
    assert.equal(ui.saved, 0);
    ui.submit();
    assert.equal(writes.length, 1);
    ui.click("Odśwież dane");
    await ui.settle();
    assert.equal(reads, 0);
    assert.equal(ui.confirms, 1);
    ui.confirm(true);
    ui.click("Odśwież dane");
    await ui.settle();
    assert.equal(reads, 1);
    const html = renderToStaticMarkup(ui.render());
    assert.ok(html.includes(mode === "complete" ? "Nie ustalono terminu" : "31 gru 2026"));
    ui.click("Bez terminu");
    ui.submit();
    await ui.settle();
    assert.equal(writes[1].expected_updated_at, freshVersion);
    assert.equal(writes[1].follow_up_date, "");
    assert.equal(ui.saved, 1);
    ui.unmount();
  }
});

test("nieudane odświeżenie follow-upu zachowuje wybrany termin i konflikt", async () => {
  let writes = 0;
  const ui = uiHarness("dialog", {
    confirmation: true,
    read: async () => { throw Error("offline"); },
    write: async () => { writes++; return { ok: false, conflict: true, message: "Konflikt" }; },
  });
  ui.click("Jutro");
  ui.submit();
  await ui.settle();
  ui.click("Odśwież dane");
  await ui.settle();
  assert.equal(ui.find((n) => n.type === "button" && n.props.children === "Jutro").props["aria-pressed"], true);
  assert.ok(ui.find((n) => n.props?.role === "alert").props.children.includes("zachowany"));
  ui.submit();
  assert.equal(writes, 1);
  ui.unmount();
});

test("odświeżenie zamkniętego leada blokuje wykonanie i przełożenie follow-upu", async () => {
  for (const mode of ["complete", "reschedule"]) {
    let writes = 0;
    const ui = uiHarness("dialog", {
      mode, confirmation: true,
      read: async () => ({ ok: true, lead: lead({ status: "won", follow_up_date: null, updated_at: "2026-11-19T13:00:00Z" }) }),
      write: async () => { writes++; return { ok: false, conflict: true, message: "Konflikt" }; },
    });
    ui.submit();
    await ui.settle();
    ui.click("Odśwież dane");
    await ui.settle();
    assert.equal(ui.find((n) => n.type === "button" && n.props.type === "submit").props.disabled, true);
    ui.submit();
    assert.equal(writes, 1);
    ui.unmount();
  }
});
test("nieudany zapis zachowuje datę i pozwala ponowić; pending blokuje wielokrotne wysłanie i zamknięcie", async () => {
  let resolve,
    calls = 0,
    submitted;
  const waiting = new Promise((done) => {
    resolve = done;
  });
  const ui = uiHarness("dialog", {
    write: async (id, data) => {
      calls++;
      submitted = Object.fromEntries(data);
      return calls === 1 ? waiting : { ok: true };
    },
  });
  ui.click("Jutro");
  ui.submit();
  ui.submit();
  assert.equal(calls, 1);
  assert.equal(ui.find((n) => n.type === "fieldset").props.disabled, true);
  ui.find((n) => n.type === "dialog").props.onCancel({ preventDefault() {} });
  assert.equal(ui.closed, 0);
  resolve({ ok: false, message: "Błąd połączenia" });
  await ui.settle();
  assert.equal(
    ui.find((n) => n.props?.role === "alert").props.children,
    "Błąd połączenia",
  );
  const date = submitted.follow_up_date;
  ui.submit();
  await ui.settle();
  assert.equal(submitted.follow_up_date, date);
  assert.equal(ui.saved, 1);
  ui.unmount();
});
test("odrzucona akcja zachowuje wybór, Escape zamyka najpierw kalendarz, potem okno", async () => {
  const ui = uiHarness("dialog", {
    mode: "reschedule",
    write: async () => {
      throw Error("network");
    },
  });
  ui.click("Wybierz datę");
  let prevented = false;
  ui.find((n) => n.type === "dialog").props.onKeyDown({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  });
  ui.render();
  assert.equal(prevented, true);
  assert.equal(ui.closed, 0);
  assert.equal(
    ui.find((n) => n.type?.name === "FollowUpCalendar"),
    undefined,
  );
  ui.submit();
  await ui.settle();
  assert.ok(ui.find((n) => n.props?.role === "alert"));
  ui.find((n) => n.type === "dialog").props.onCancel({ preventDefault() {} });
  assert.equal(ui.closed, 1);
  ui.unmount();
});

test("otwarty widok przenosi dzisiejszy termin do zaległych po północy w Warszawie", () => {
  const ui = uiHarness("list", { now: "2026-11-18T22:59:59Z" });
  function count(key) {
    return nodes(ui.render())
      .filter(
        (n) =>
          n.type === "section" &&
          n.props["aria-labelledby"] === `follow-ups-${key}`,
      )
      .flatMap(nodes)
      .filter((n) => n.type === "article").length;
  }
  assert.equal(count("today"), 1);
  ui.setNow("2026-11-18T23:00:01Z");
  assert.equal(count("today"), 0);
  assert.equal(count("overdue"), 1);
  ui.unmount();
});
test("kalendarz korzysta z jawnego dzisiaj i nie sugeruje wyboru daty przy pustym terminie", () => {
  const { FollowUpCalendar } = loadModule(
    "src/components/pipeline/follow-up-calendar.tsx",
  );
  const React = require("react");
  const html = renderToStaticMarkup(
    React.createElement(FollowUpCalendar, {
      value: "",
      today: "2027-01-01",
      onSelect() {},
    }),
  );
  assert.ok(html.includes("styczeń 2027"));
  assert.equal((html.match(/aria-current="date"/g) ?? []).length, 1);
  assert.equal(html.includes('aria-pressed="true"'), false);
});
test("po zapisie fokus pozostaje na stabilnej liście także po zmianie sekcji", async () => {
  const ui = uiHarness("list");
  ui.click("Wykonano");
  ui.find((n) => n.type?.name === "FollowUpDialog").props.onSaved();
  ui.render([lead({ follow_up_date: null })]);
  await ui.settle();
  assert.equal(ui.focused, "list");
  ui.unmount();
});
test("strona rozróżnia pusty odczyt i błąd, udostępniając ponowienie pobrania", async () => {
  for (const result of [{ ok: true, leads: [] }, { ok: false }]) {
    const { default: Page } = loadModule("src/app/(crm)/follow-ups/page.tsx", {
      "@/lib/leads/follow-up-queries": { getFollowUpLeads: async () => result },
    });
    const tree = await Page();
    if (result.ok)
      assert.ok(nodes(tree).some((n) => n.type?.name === "FollowUpsList"));
    else {
      assert.equal(
        nodes(tree).some((n) => n.type?.name === "FollowUpsList"),
        false,
      );
      assert.ok(nodes(tree).some((n) => n.props?.role === "alert"));
      assert.equal(
        nodes(tree).find((n) => n.type === "a").props.href,
        "/follow-ups",
      );
    }
  }
});
