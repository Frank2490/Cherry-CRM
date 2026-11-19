import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadModule(relativePath, mocks = {}, cache = new Map(), globals = {}) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      module: moduleObject,
      exports: moduleObject.exports,
      console,
      URL,
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name.startsWith("@/")) {
          const base = "src/" + name.slice(2);
          return loadModule(
            [base + ".ts", base + ".tsx"].find((file) =>
              fs.existsSync(path.join(root, file)),
            ),
            mocks,
            cache,
            globals,
          );
        }
        return require(name);
      },
      ...globals,
    },
    { filename },
  );
  return moduleObject.exports;
}
const creation = loadModule("src/lib/leads/create.ts");
const dates = loadModule("src/lib/leads/dates.ts");
const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Wyłącznie dane w pamięci procesu; testy nie łączą się z Supabase.
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    ...creation.emptyLeadValues(),
    creation_request_id: requestId,
    company_name: "  Nazwa   z rekordu  ",
    contact_value: "  @kontakt  ",
    ...overrides,
  }))
    data.set(key, value);
  return data;
}

test("domyślny formularz ma Nowy, Instagram i pusty termin; minimalne dane przechodzą", () => {
  const defaults = creation.emptyLeadValues();
  assert.equal(defaults.status, "new");
  assert.equal(defaults.contact_type, "instagram");
  assert.equal(defaults.follow_up_date, "");
  const result = creation.validateCreateLead(form());
  assert.equal(result.ok, true);
  assert.equal(result.values.company_name, "Nazwa z rekordu");
  assert.equal(result.values.contact_value, "@kontakt");
});

test("walidacja wymaga nazwy, kontaktu, dozwolonego typu i statusu", () => {
  for (const [key, value] of [
    ["company_name", " \t\n"],
    ["contact_value", " "],
    ["contact_type", "invalid"],
    ["status", "invalid"],
    ["status", ""],
    ["contact_type", ""],
  ]) {
    const result = creation.validateCreateLead(form({ [key]: value }));
    assert.equal(result.ok, false);
    assert.ok(result.fieldErrors[key]);
  }
  assert.equal(
    creation.validateCreateLead(
      form({ contact_type: "email", contact_value: "invalid" }),
    ).ok,
    false,
  );
});

test("siedem statusów przyjmuje NULL; zamknięte wymuszają pusty termin", () => {
  for (const status of LEAD_STATUSES) {
    assert.equal(
      creation.validateCreateLead(form({ status: status.value })).ok,
      true,
    );
    const dated = creation.validateCreateLead(
      form({ status: status.value, follow_up_date: "2026-12-31" }),
    );
    assert.equal(dated.ok, true);
    assert.equal(
      dated.values.follow_up_date,
      ["won", "lost"].includes(status.value) ? "" : "2026-12-31",
    );
  }
  const closed = creation.updateLeadStatus(
    { ...creation.emptyLeadValues(), follow_up_date: "2026-12-31" },
    "won",
  );
  assert.equal(closed.follow_up_date, "");
  assert.equal(creation.updateLeadStatus(closed, "new").follow_up_date, "");
  assert.equal(
    creation.updateLeadStatus(
      { ...closed, status: "new", follow_up_date: "2026-12-31" },
      "lost",
    ).follow_up_date,
    "",
  );
});

test("walidacja odrzuca nieistniejące daty, przyjmuje rok przestępny i pustą datę", () => {
  for (const value of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "0000-01-01",
    "2026-01-00",
    "17.11.2026",
    "infinity",
  ]) {
    assert.equal(
      creation.validateCreateLead(form({ follow_up_date: value })).ok,
      false,
      value,
    );
  }
  for (const value of ["", "2028-02-29", "2026-12-31"])
    assert.equal(
      creation.validateCreateLead(form({ follow_up_date: value })).ok,
      true,
    );
});

test("szybkie opcje przekraczają miesiąc i rok według lokalnego kalendarza", () => {
  const now = dates.parseLocalDate("2026-12-29");
  assert.deepEqual(
    [0, 1, 3, 7].map((days) =>
      dates.formatLocalDate(dates.addLocalDays(now, days)),
    ),
    ["2026-12-29", "2026-12-30", "2027-01-01", "2027-01-05"],
  );
  assert.equal(
    dates.formatLocalDate(
      dates.addLocalDays(dates.parseLocalDate("2028-02-28"), 1),
    ),
    "2028-02-29",
  );
  assert.equal(
    dates.formatLocalDate(
      dates.addLocalDays(dates.parseLocalDate("2026-03-28"), 1),
    ),
    "2026-03-29",
  );
});

test("lokalne daty nie są zamieniane na dzień UTC w odległych strefach", () => {
  const compiled = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/lib/leads/dates.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const code = `const vm=require('node:vm');const object={exports:{}};vm.runInNewContext(${JSON.stringify(compiled)},{module:object,exports:object.exports});const d=object.exports;console.log(d.formatLocalDate(new Date(2026,11,31,0,15)));console.log(d.formatLocalDate(d.addLocalDays(new Date(2026,11,31,23,45),1)));`;
  for (const zone of ["Pacific/Kiritimati", "America/Adak", "Europe/Warsaw"]) {
    assert.equal(
      execFileSync(process.execPath, ["-e", code], {
        encoding: "utf8",
        env: { ...process.env, TZ: zone },
      }).trim(),
      "2026-12-31\n2027-01-01",
    );
  }
});

test("kalendarz tworzy pełną siatkę i obsługuje nawigację między miesiącami", () => {
  const days = dates.calendarMonthDays(dates.parseLocalDate("2027-01-01"));
  assert.equal(days.length, 42);
  assert.equal(days[0].value, "2026-12-28");
  assert.ok(days.some((day) => day.value === "2027-01-31" && day.inMonth));
  assert.equal(
    dates.calendarNavigation("2027-01-01", "ArrowLeft"),
    "2026-12-31",
  );
  assert.equal(dates.calendarNavigation("2026-03-31", "PageUp"), "2026-02-28");
  assert.equal(dates.calendarNavigation("2028-03-31", "PageUp"), "2028-02-29");
  assert.equal(dates.calendarNavigation("2026-11-18", "Home"), "2026-11-16");
  assert.equal(dates.calendarNavigation("2026-11-18", "End"), "2026-11-22");
});

function actionHarness(
  response = { data: { id: "new-id" }, error: null },
  claims = { sub: "verified-owner" },
  invalidate = () => {},
) {
  const inserts = [];
  const builder = {
    schema: () => builder,
    from: () => builder,
    insert: (payload) => {
      inserts.push(payload);
      return builder;
    },
    select: () => builder,
    single: () => builder,
    overrideTypes: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const actions = loadModule("src/app/actions/leads.ts", {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
    "@/lib/supabase/server": { createClient: async () => builder },
    "next/cache": { revalidatePath: invalidate },
  });
  return { ...actions, inserts };
}

test("zapis wybiera właściwy kontakt i ignoruje user_id oraz zbędne pola formularza", async () => {
  for (const [type, value] of [
    ["instagram", "@kontakt"],
    ["email", "kontakt@example.invalid"],
    ["phone", "500 600 700"],
  ]) {
    const paths = [];
    const action = actionHarness(undefined, undefined, (route) =>
      paths.push(route),
    );
    assert.equal(
      (
        await action.createLead(
          form({
            contact_type: type,
            contact_value: value,
            user_id: "forged-owner",
            estimated_value: "999",
          }),
        )
      ).ok,
      true,
    );
    assert.equal(action.inserts.length, 1);
    const payload = action.inserts[0];
    assert.equal(payload.user_id, "verified-owner");
    assert.equal(payload.creation_request_id, requestId);
    assert.equal(payload.follow_up_date, null);
    assert.equal("estimated_value" in payload, false);
    for (const column of ["instagram", "email", "phone"])
      assert.equal(payload[column], column === type ? value : null);
    assert.deepEqual(paths, ["/pipeline", "/follow-ups", "/calendar"]);
  }
});

test("zapis obsługuje datę aktywnego leada oraz NULL dla wszystkich statusów", async () => {
  for (const status of LEAD_STATUSES) {
    for (const date of ["", "2026-12-31"]) {
      const action = actionHarness();
      assert.equal(
        (
          await action.createLead(
            form({ status: status.value, follow_up_date: date }),
          )
        ).ok,
        true,
      );
      assert.equal(
        action.inserts[0].follow_up_date,
        ["won", "lost"].includes(status.value) ? null : date || null,
      );
    }
  }
});

test("brak sesji i walidacja blokują INSERT; błędy bazy nie udają sukcesu", async () => {
  const guest = actionHarness(undefined, null);
  assert.equal((await guest.createLead(form())).ok, false);
  assert.equal(guest.inserts.length, 0);
  const invalid = actionHarness();
  assert.equal(
    (await invalid.createLead(form({ company_name: "" }))).ok,
    false,
  );
  assert.equal(invalid.inserts.length, 0);
  for (const response of [
    { data: null, error: { code: "42501", message: "internal-detail" } },
    new Error("network"),
  ]) {
    const result = await actionHarness(response).createLead(form());
    assert.equal(result.ok, false);
    assert.ok(result.message);
    assert.equal(result.message.includes("internal-detail"), false);
  }
  const migration = await actionHarness({
    data: null,
    error: {
      code: "23514",
      message: 'violates check constraint "leads_follow_up_matches_status"',
    },
  }).createLead(form());
  assert.match(migration.message, /migrację etapu 3B/);
});

test("potwierdzony INSERT pozostaje sukcesem przy awarii cache", async () => {
  const action = actionHarness(undefined, undefined, () => {
    throw new Error("cache unavailable");
  });
  assert.equal((await action.createLead(form())).ok, true);
  assert.equal(action.inserts.length, 1);
});

test("SSR nie renderuje zamkniętego formularza ani warstwy dialogu", () => {
  const { AddLeadDialog } = loadModule(
    "src/components/pipeline/add-lead-dialog.tsx",
    {
      "next/navigation": { useRouter: () => ({ refresh() {} }) },
      "@/app/actions/leads": { createLead: async () => ({ ok: true }) },
    },
  );
  const html = renderToStaticMarkup(createElement(AddLeadDialog));
  assert.ok(html.includes("+ Dodaj leada"));
  assert.equal(html.includes("<dialog"), false);
  assert.equal(html.includes("<form"), false);
});

// Testy kontrolera z atrapą hooków: nie zastępują testów natywnego dialogu w przeglądarce.
function dialogHarness(action) {
  const hooks = [],
    tasks = [],
    frames = [],
    effects = [];
  let cursor = 0,
    tree,
    refreshes = 0,
    companyFocus = 0,
    triggerFocus = 0,
    uuidCount = 0,
    confirms = 0,
    confirmation = false;
  const listeners = new Map();
  const fakeWindow = {
    confirm() { confirms++; return confirmation; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  const fakeDocument = { body: { style: { overflow: "" } } };
  const React = require("react");
  const fakeReact = {
    ...React,
    useRef(value) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = { current: value };
      return hooks[slot];
    },
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks))
        hooks[slot] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[slot],
        (next) => {
          hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next;
        },
      ];
    },
    useEffect(callback, deps) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (
        !previous ||
        deps.some((value, index) => !Object.is(value, previous.deps[index]))
      ) {
        hooks[slot] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          hooks[slot].cleanup?.();
          hooks[slot].cleanup = callback();
        });
      }
    },
    useTransition() {
      const [pending, setPending] = fakeReact.useState(false);
      return [
        pending,
        (callback) => {
          setPending(true);
          tasks.push(
            (async () => {
              try {
                await callback();
              } finally {
                setPending(false);
              }
            })(),
          );
        },
      ];
    },
  };
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((entry) => nodes(entry));
    return [node, ...nodes(node.props?.children)];
  }
  const find = (predicate) => nodes(tree).find(predicate);
  const dialog = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      find((node) => node.type === "dialog")?.props.onClose();
    },
    querySelector() {
      return { focus() {} };
    },
  };
  class TestFormData extends FormData {
    constructor(source) {
      super();
      for (const [key, value] of source.entries()) this.set(key, value);
    }
  }
  const { AddLeadDialog } = loadModule(
    "src/components/pipeline/add-lead-dialog.tsx",
    {
      react: fakeReact,
      "next/navigation": {
        useRouter: () => ({
          refresh() {
            refreshes++;
          },
        }),
      },
      "@/app/actions/leads": { createLead: action },
    },
    new Map(),
    {
      document: fakeDocument,
      window: fakeWindow,
      FormData: TestFormData,
      crypto: {
        randomUUID() {
          uuidCount++;
          return `aaaaaaaa-aaaa-4aaa-8aaa-${String(uuidCount).padStart(12, "0")}`;
        },
      },
      requestAnimationFrame: (callback) => frames.push(callback),
    },
  );
  function render() {
    cursor = 0;
    tree = AddLeadDialog();
    const dialogNode = find((node) => node.type === "dialog");
    if (dialogNode) dialogNode.props.ref.current = dialog;
    find(
      (node) => node.props?.["aria-haspopup"] === "dialog",
    ).props.ref.current = {
      focus() {
        triggerFocus++;
      },
    };
    const companyNode = find((node) => node.props?.id === "lead-company");
    if (companyNode)
      companyNode.props.ref.current = {
        focus() {
          companyFocus++;
        },
      };
    const calendarTrigger = find(
      (node) => node.props?.["aria-controls"] === "lead-follow-up-calendar",
    );
    if (calendarTrigger) calendarTrigger.props.ref.current = { focus() {} };
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  render();
  return {
    find,
    render,
    dialog,
    listeners,
    confirm(value) { confirmation = value; },
    get confirms() { return confirms; },
    clickSurface({ x = 10, y = 10, child = false } = {}) {
      const currentTarget = { getBoundingClientRect: () => ({ left: 100, right: 400, top: 100, bottom: 700 }) };
      find((node) => node.type === "dialog").props.onClick({
        target: child ? {} : currentTarget, currentTarget, clientX: x, clientY: y,
      });
      render();
    },
    unmount() {
      for (const hook of hooks) hook?.cleanup?.();
    },
    open() {
      find(
        (node) => node.props?.["aria-haspopup"] === "dialog",
      ).props.onClick();
      render();
    },
    change(id, value) {
      find((node) => node.props?.id === id).props.onChange({
        target: { value },
      });
      render();
    },
    click(label) {
      find(
        (node) => node.type === "button" && node.props.children === label,
      ).props.onClick();
      render();
    },
    submit() {
      const data = form({
        company_name: find((node) => node.props?.name === "company_name").props
          .value,
        contact_value: find((node) => node.props?.name === "contact_value")
          .props.value,
      });
      find((node) => node.type === "form").props.onSubmit({
        preventDefault() {},
        currentTarget: data,
      });
      render();
    },
    async settle() {
      await Promise.all(tasks);
      render();
      frames.splice(0).forEach((callback) => callback());
    },
    get refreshes() {
      return refreshes;
    },
    get companyFocus() {
      return companyFocus;
    },
    get triggerFocus() {
      return triggerFocus;
    },
    get overflow() {
      return fakeDocument.body.style.overflow;
    },
    get uuidCount() {
      return uuidCount;
    },
  };
}

test("kontroler zachowuje dane po błędzie; po ponowieniu zamyka modal i odświeża Pipeline", async () => {
  let attempts = 0;
  const ui = dialogHarness(async () =>
    ++attempts === 1
      ? { ok: false, message: "Spróbuj ponownie" }
      : { ok: true },
  );
  ui.open();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.companyFocus, 1);
  assert.equal(ui.overflow, "hidden");
  ui.change("lead-company", "Moja nazwa");
  ui.change("lead-contact", "@mojkontakt");
  ui.submit();
  await ui.settle();
  assert.equal(ui.dialog.open, true);
  assert.equal(
    ui.find((node) => node.props?.id === "lead-company").props.value,
    "Moja nazwa",
  );
  assert.equal(
    ui.find((node) => node.props?.id === "lead-contact").props.value,
    "@mojkontakt",
  );
  assert.equal(
    ui.find((node) => node.props?.role === "alert").props.children,
    "Spróbuj ponownie",
  );
  ui.submit();
  await ui.settle();
  assert.equal(attempts, 2);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.refreshes, 1);
  assert.ok(ui.triggerFocus >= 1);
  assert.equal(ui.overflow, "");
  assert.equal(
    ui.find((node) => node.props?.role === "status").props.children,
    "Lead został dodany.",
  );
});

test("kontroler blokuje podwójne wysłanie i zamknięcie podczas zapisu", async () => {
  let resolve,
    calls = 0;
  const response = new Promise((done) => {
    resolve = done;
  });
  const ui = dialogHarness(() => {
    calls++;
    return response;
  });
  ui.open();
  ui.submit();
  ui.submit();
  assert.equal(calls, 1);
  assert.equal(
    ui.find((node) => node.type === "fieldset").props.disabled,
    true,
  );
  let prevented = false;
  ui.find((node) => node.type === "dialog").props.onCancel({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  ui.find(
    (node) => node.props?.["aria-label"] === "Zamknij formularz",
  ).props.onClick();
  assert.equal(ui.dialog.open, true);
  resolve({ ok: false, message: "Błąd zapisu" });
  await ui.settle();
});

test("kontroler wybiera datę z kalendarza, czyści ją i nie przywraca po zamkniętym statusie", () => {
  const ui = dialogHarness(async () => ({ ok: true }));
  ui.open();
  ui.find(
    (node) => node.props?.["aria-controls"] === "lead-follow-up-calendar",
  ).props.onClick();
  ui.render();
  ui.find(
    (node) =>
      typeof node.type === "function" && node.type.name === "FollowUpCalendar",
  ).props.onSelect("2026-12-31");
  ui.render();
  assert.equal(
    ui.find((node) => node.props?.name === "follow_up_date").props.value,
    "2026-12-31",
  );
  ui.click("Wyczyść termin");
  assert.equal(
    ui.find((node) => node.props?.name === "follow_up_date").props.value,
    "",
  );
  ui.click("Jutro");
  assert.equal(
    dates.isValidDateOnly(
      ui.find((node) => node.props?.name === "follow_up_date").props.value,
    ),
    true,
  );
  ui.change("lead-status", "won");
  assert.equal(
    ui.find((node) => node.props?.name === "follow_up_date").props.value,
    "",
  );
  ui.change("lead-status", "new");
  assert.equal(
    ui.find((node) => node.props?.name === "follow_up_date").props.value,
    "",
  );
});

test("dodawanie otwiera się tylko po kliknięciu i można je wielokrotnie zamykać oraz otwierać", () => {
  const ui = dialogHarness(async () => ({ ok: true }));
  assert.equal(
    ui.find((node) => node.type === "dialog"),
    undefined,
  );
  for (let index = 0; index < 3; index++) {
    ui.open();
    const dialog = ui.find((node) => node.type === "dialog");
    assert.ok(dialog.props.className.includes("fixed inset-0 m-auto"));
    assert.equal(ui.dialog.open, true);
    assert.equal(
      ui.find((node) => node.props?.name === "company_name").props.value,
      "",
    );
    ui.find(
      (node) => node.props?.["aria-label"] === "Zamknij formularz",
    ).props.onClick();
    ui.render();
    assert.equal(ui.dialog.open, false);
    assert.equal(
      ui.find((node) => node.type === "dialog"),
      undefined,
    );
    assert.equal(ui.overflow, "");
  }
});

test("Escape i demontaż zwalniają dialog; nowy render po odświeżeniu nie otwiera formularza", () => {
  const ui = dialogHarness(async () => ({ ok: true }));
  ui.open();
  ui.find((node) => node.type === "dialog").props.onCancel({
    preventDefault() {},
  });
  ui.render();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.overflow, "");
  ui.open();
  ui.unmount();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.overflow, "");
  const afterReload = dialogHarness(async () => ({ ok: true }));
  assert.equal(
    afterReload.find((node) => node.type === "dialog"),
    undefined,
  );
  afterReload.open();
  assert.equal(afterReload.dialog.open, true);
  afterReload.unmount();
});

test("błąd i utrata odpowiedzi zachowują UUID; dopiero potwierdzony sukces rozpoczyna nową operację", async () => {
  const sent = [];
  const ui = dialogHarness(async (data) => {
    sent.push(Object.fromEntries(data));
    if (sent.length === 1) return { ok: false, message: "Błąd połączenia" };
    if (sent.length === 2) throw Error("Utracona odpowiedź");
    return { ok: true, lead: { id: "lead-id" } };
  });
  ui.open();
  ui.change("lead-company", "Mój klient");
  ui.change("lead-contact", "@mojkontakt");
  for (let attempt = 0; attempt < 3; attempt++) {
    ui.submit();
    await ui.settle();
  }
  assert.equal(new Set(sent.map((data) => data.creation_request_id)).size, 1);
  assert.equal(ui.uuidCount, 1);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.refreshes, 1);
  ui.open();
  assert.equal(ui.find((n) => n.props?.id === "lead-company").props.value, "");
  ui.change("lead-company", "Mój klient");
  ui.change("lead-contact", "@mojkontakt");
  ui.submit();
  await ui.settle();
  assert.notEqual(sent[3].creation_request_id, sent[0].creation_request_id);
  assert.equal(ui.uuidCount, 2);
  assert.equal(ui.refreshes, 2);
  ui.unmount();
});

test("anulowane zamknięcie niepotwierdzonego formularza zachowuje szkic i UUID", async () => {
  const sent = [];
  const ui = dialogHarness(async (data) => {
    sent.push(Object.fromEntries(data));
    return { ok: false, message: "Nie udało się potwierdzić zapisu" };
  });
  ui.open();
  ui.change("lead-company", "Niezapisany szkic");
  ui.change("lead-contact", "@kontakt");
  ui.submit();
  await ui.settle();
  ui.find((n) => n.props?.["aria-label"] === "Zamknij formularz").props.onClick();
  ui.render();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.confirms, 1);
  ui.open();
  assert.equal(ui.find((n) => n.props?.id === "lead-company").props.value, "Niezapisany szkic");
  assert.equal(ui.find((n) => n.props?.id === "lead-contact").props.value, "@kontakt");
  ui.change("lead-company", "Poprawiony szkic");
  ui.submit();
  await ui.settle();
  assert.equal(sent[1].creation_request_id, sent[0].creation_request_id);
  assert.equal(ui.uuidCount, 1);
  assert.equal(ui.dialog.open, true);
  ui.unmount();
});

test("Dodaj leada: X, Escape i overlay ostrzegają; anulowanie zachowuje wszystkie pola", () => {
  for (const close of [
    (ui) => ui.find((n) => n.props?.["aria-label"] === "Zamknij formularz").props.onClick(),
    (ui) => ui.find((n) => n.type === "dialog").props.onCancel({ preventDefault() {} }),
    (ui) => ui.clickSurface(),
  ]) {
    const ui = dialogHarness(async () => ({ ok: true, lead: { id: "id" } }));
    ui.open();
    ui.change("lead-company", "Niezapisana firma");
    ui.change("lead-contact", "@kontakt");
    close(ui);
    ui.render();
    assert.equal(ui.confirms, 1);
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.find((n) => n.props?.id === "lead-company").props.value, "Niezapisana firma");
    assert.equal(ui.find((n) => n.props?.id === "lead-contact").props.value, "@kontakt");
    assert.equal(ui.listeners.has("beforeunload"), true);
    ui.confirm(true);
    close(ui);
    ui.render();
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.listeners.has("beforeunload"), false);
    ui.open();
    assert.equal(ui.find((n) => n.props?.id === "lead-company").props.value, "");
    ui.unmount();
    assert.equal(ui.listeners.size, 0);
  }
});

test("Dodaj leada: bez zmian nie pyta; przywrócenie wartości domyślnych usuwa ochronę", () => {
  const ui = dialogHarness(async () => ({ ok: true, lead: { id: "id" } }));
  ui.open();
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.change("lead-company", "Szkic");
  assert.equal(ui.listeners.has("beforeunload"), true);
  ui.change("lead-company", "");
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.click("Anuluj");
  assert.equal(ui.confirms, 0);
  assert.equal(ui.dialog.open, false);
  ui.open();
  ui.clickSurface();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.confirms, 0);
  ui.unmount();
});

test("Dodaj leada: kliknięcie treści lub pustego miejsca wewnątrz nie zamyka modala", () => {
  const ui = dialogHarness(async () => ({ ok: true, lead: { id: "id" } }));
  ui.open();
  ui.change("lead-company", "Szkic");
  ui.clickSurface({ x: 200, y: 200 });
  ui.clickSurface({ x: 10, y: 10, child: true });
  assert.equal(ui.confirms, 0);
  assert.equal(ui.dialog.open, true);
  ui.unmount();
});

test("Dodaj leada: udany zapis zamyka bez pytania i usuwa ochronę przed opuszczeniem strony", async () => {
  const ui = dialogHarness(async () => ({ ok: true, lead: { id: "id" } }));
  ui.open();
  ui.change("lead-company", "Firma");
  ui.change("lead-contact", "@kontakt");
  assert.equal(ui.listeners.has("beforeunload"), true);
  ui.submit();
  await ui.settle();
  assert.equal(ui.confirms, 0);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.listeners.has("beforeunload"), false);
  assert.equal(ui.refreshes, 1);
  ui.unmount();
});

test("Dodaj leada: świadome odrzucenie szkicu kończy operację i nowy formularz otrzymuje nowy UUID", async () => {
  const requests = [];
  const ui = dialogHarness(async (data) => {
    requests.push(data.get("creation_request_id"));
    return { ok: false, message: "Błąd zapisu" };
  });
  ui.open();
  ui.change("lead-company", "Szkic");
  ui.change("lead-contact", "@kontakt");
  ui.submit();
  await ui.settle();
  ui.confirm(true);
  ui.click("Anuluj");
  ui.open();
  ui.change("lead-company", "Nowa próba");
  ui.change("lead-contact", "@kontakt");
  ui.submit();
  await ui.settle();
  assert.notEqual(requests[0], requests[1]);
  assert.equal(ui.uuidCount, 2);
  ui.unmount();
});
