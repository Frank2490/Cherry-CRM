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

const details = loadModule("src/lib/leads/details.ts");
const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const leadId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const otherId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const version = "2026-11-19T12:00:00.123456+00:00";

// Wszystkie rekordy i odpowiedzi SDK są lokalnymi atrapami, bez żądań do Supabase.
function lead(overrides = {}) {
  return {
    id: leadId,
    updated_at: version,
    company_name: "Nazwa z rekordu",
    instagram: "@kontakt",
    email: null,
    phone: null,
    status: "new",
    service_type: null,
    estimated_value: null,
    follow_up_date: null,
    next_step: null,
    notes: null,
    created_at: "2026-11-17T12:00:00Z",
    last_contact_at: null,
    ...overrides,
  };
}
function form(overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    ...details.leadEditValues(lead()),
    expected_updated_at: version,
    ...overrides,
  }))
    data.set(key, value);
  return data;
}

test("formularz otrzymuje istniejące dane, zachowuje zero i zamienia opcjonalne NULL na puste pola", () => {
  const saved = lead({
    estimated_value: 0,
    email: "a@example.invalid",
    next_step: "Rozmowa",
  });
  const values = details.leadEditValues(saved);
  assert.equal(values.estimated_value, "0");
  assert.equal(values.email, saved.email);
  assert.equal(values.phone, "");
  assert.equal(values.follow_up_date, "");
  assert.equal(values.next_step, "Rozmowa");
  for (const field of ["id", "user_id", "created_at", "last_contact_at"])
    assert.equal(field in values, false);
  assert.equal(details.hasLeadChanges(values, saved), false);
  assert.equal(
    details.hasLeadChanges({ ...values, notes: "Cena" }, saved),
    true,
  );
});

test("walidacja zachowuje wszystkie edytowalne pola i usuwa nadmiarowe spacje", () => {
  const result = details.validateLeadUpdate(
    form({
      company_name: "  Nowa   nazwa  ",
      instagram: " @profil ",
      email: " a@example.invalid ",
      phone: " 500 600 700 ",
      service_type: " Sklep ",
      estimated_value: " 1250,50 ",
      follow_up_date: "2028-02-29",
      next_step: " Rozmowa ",
      notes: " Sklep online\nTermin ",
      client_needs: "Nie aktualizuj",
      client_concerns: "Nie aktualizuj",
      user_id: otherId,
      id: otherId,
      created_at: "2000-01-01",
      last_contact_at: "2000-01-01",
      updated_at: "2000-01-01",
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.payload)), {
    company_name: "Nowa nazwa",
    instagram: "@profil",
    email: "a@example.invalid",
    phone: "500 600 700",
    status: "new",
    service_type: "Sklep",
    estimated_value: "1250.50",
    follow_up_date: "2028-02-29",
    next_step: "Rozmowa",
    notes: "Sklep online\nTermin",
  });
});

test("wystarczy jeden z trzech kontaktów; pozostałe pola mogą być puste", () => {
  for (const contact of ["instagram", "email", "phone"]) {
    const result = details.validateLeadUpdate(
      form({
        instagram: "",
        email: "",
        phone: "",
        [contact]: contact === "email" ? "a@example.invalid" : "kontakt",
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.payload.estimated_value, null);
    assert.equal(result.payload.follow_up_date, null);
  }
});

test("walidacja odrzuca brak nazwy lub kontaktu, zły e-mail, status, datę i niepoprawną kwotę", () => {
  for (const [input, field] of [
    [{ company_name: " \t\n" }, "company_name"],
    [{ instagram: " ", email: "", phone: "" }, "contacts"],
    [{ email: "invalid" }, "email"],
    [{ status: "invalid" }, "status"],
    [{ follow_up_date: "2026-02-29" }, "follow_up_date"],
    [{ follow_up_date: "2026-13-01" }, "follow_up_date"],
    ...["-1", "NaN", "Infinity", "1e2", "10000000000", "1.234", "1,2,3"].map(
      (estimated_value) => [{ estimated_value }, "estimated_value"],
    ),
  ]) {
    const result = details.validateLeadUpdate(form(input));
    assert.equal(result.ok, false);
    assert.ok(result.fieldErrors[field]);
  }
  for (const value of ["0", "9999999999.99", "0,01"])
    assert.equal(
      details.validateLeadUpdate(form({ estimated_value: value })).ok,
      true,
    );
});

test("siedem statusów obsługuje pustą datę; won/lost wymuszają NULL i nie przywracają terminu", () => {
  for (const status of LEAD_STATUSES) {
    assert.equal(
      details.validateLeadUpdate(form({ status: status.value })).ok,
      true,
    );
    const result = details.validateLeadUpdate(
      form({ status: status.value, follow_up_date: "2026-12-31" }),
    );
    assert.equal(result.ok, true);
    assert.equal(
      result.payload.follow_up_date,
      ["won", "lost"].includes(status.value) ? null : "2026-12-31",
    );
  }
  for (const status of ["won", "lost"]) {
    const closed = details.changeEditStatus(
      { ...details.leadEditValues(lead()), follow_up_date: "2026-12-31" },
      status,
    );
    assert.equal(closed.follow_up_date, "");
    assert.equal(details.changeEditStatus(closed, "new").follow_up_date, "");
  }
});

function actionHarness({
  claims = { sub: owner },
  response = { data: lead(), error: null },
  cacheError = false,
  databaseLead,
} = {}) {
  const calls = [];
  let refreshes = 0;
  const builder = {};
  for (const method of [
    "schema",
    "from",
    "select",
    "update",
    "delete",
    "eq",
    "in",
  ])
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  builder.overrideTypes = async () => {
    if (response instanceof Error) throw response;
    return response;
  };
  builder.maybeSingle = () => {
    calls.push(["maybeSingle"]);
    if (!calls.some(([method]) => method === "delete")) return builder;
    if (databaseLead !== undefined) {
      const matches = databaseLead && calls.every(([method, column, value]) => {
        if (method === "eq") return databaseLead[column] === value;
        if (method === "in") return value.includes(databaseLead[column]);
        return true;
      });
      return Promise.resolve({ data: matches ? { id: databaseLead.id } : null, error: null });
    }
    return builder.overrideTypes();
  };
  const actions = loadModule("src/app/actions/leads.ts", {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
    "@/lib/supabase/server": { createClient: async () => builder },
    "next/cache": {
      revalidatePath(destination) {
        assert.ok(
          ["/pipeline", "/follow-ups", "/calendar"].includes(destination),
        );
        refreshes++;
        if (cacheError) throw new Error("cache");
      },
    },
  });
  return {
    ...actions,
    calls,
    get refreshes() {
      return refreshes;
    },
  };
}

test("szczegóły są pobierane tylko dla zweryfikowanego właściciela i wskazanego UUID", async () => {
  const action = actionHarness();
  const result = await action.getLeadDetails(leadId);
  assert.equal(result.ok, true);
  assert.deepEqual(
    action.calls.filter(([name]) => name === "eq"),
    [
      ["eq", "id", leadId],
      ["eq", "user_id", owner],
    ],
  );
  const projection = action.calls.find(([name]) => name === "select")[1];
  assert.ok(projection.includes("notes"));
  assert.equal(projection.includes("client_needs"), false);
  assert.equal(projection.includes("client_concerns"), false);
  assert.ok(projection.includes("created_at"));
  assert.ok(projection.includes("updated_at"));
  assert.equal(projection.includes("*"), false);
  assert.equal(projection.includes("user_id"), false);
});

test("brak sesji lub poprawnego ID blokuje odczyt i aktualizację przed zapytaniem", async () => {
  for (const options of [{ claims: null }, {}]) {
    const action = actionHarness(options);
    const id = options.claims === null ? leadId : "not-a-uuid";
    assert.equal((await action.getLeadDetails(id)).ok, false);
    assert.equal((await action.updateLead(id, form())).ok, false);
    assert.equal(action.calls.length, 0);
  }
  const action = actionHarness();
  assert.equal(
    (await action.updateLead(leadId, form({ company_name: "" }))).ok,
    false,
  );
  assert.equal(action.calls.length, 0);
});

test("UPDATE ma oba filtry właściciela i ID; nie zmienia pól chronionych ani dat kontaktu", async () => {
  const action = actionHarness();
  const result = await action.updateLead(
    leadId,
    form({
      company_name: "Nowa nazwa",
      instagram: "",
      phone: "500 600 700",
      estimated_value: "0",
      user_id: otherId,
      id: otherId,
      created_at: "2000-01-01",
      last_contact_at: "2000-01-01",
      updated_at: "2000-01-01",
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    action.calls.filter(([name]) => name === "eq"),
    [
      ["eq", "id", leadId],
      ["eq", "user_id", owner],
      ["eq", "updated_at", version],
    ],
  );
  const payload = action.calls.find(([name]) => name === "update")[1];
  for (const field of [
    "user_id",
    "id",
    "created_at",
    "last_contact_at",
    "updated_at",
    "client_needs",
    "client_concerns",
  ])
    assert.equal(field in payload, false);
  assert.equal(payload.instagram, null);
  assert.equal(payload.email, null);
  assert.equal(payload.phone, "500 600 700");
  assert.equal(payload.estimated_value, "0");
  for (const field of ["service_type", "follow_up_date", "next_step", "notes"])
    assert.equal(payload[field], null);
  assert.equal(action.refreshes, 3);
  assert.equal(result.revalidated, true);
});

test("cudzy lub niedostępny lead nie daje sukcesu przy odczycie ani zerowej aktualizacji", async () => {
  const action = actionHarness({ response: { data: null, error: null } });
  assert.equal((await action.getLeadDetails(otherId)).ok, false);
  const result = await action.updateLead(otherId, form());
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(action.refreshes, 0);
  assert.ok(
    action.calls
      .filter(([name]) => name === "eq")
      .some(([, column, value]) => column === "user_id" && value === owner),
  );
});

test("zapis serwerowy obsługuje siedem statusów, termin, PLN i puste pola", async () => {
  for (const status of LEAD_STATUSES) {
    const action = actionHarness();
    assert.equal(
      (
        await action.updateLead(
          leadId,
          form({
            status: status.value,
            follow_up_date: "2026-12-31",
            estimated_value: "1234,56",
          }),
        )
      ).ok,
      true,
    );
    const payload = action.calls.find(([name]) => name === "update")[1];
    assert.equal(
      payload.follow_up_date,
      ["won", "lost"].includes(status.value) ? null : "2026-12-31",
    );
    assert.equal(payload.estimated_value, "1234.56");
  }
});

test("błędy SDK i brak migracji są czytelne; potwierdzony zapis nie staje się błędem cache", async () => {
  for (const response of [
    new Error("private network detail"),
    { data: null, error: { code: "42501", message: "private SQL detail" } },
  ]) {
    const action = actionHarness({ response });
    assert.equal((await action.getLeadDetails(leadId)).ok, false);
    const result = await action.updateLead(leadId, form());
    assert.equal(result.ok, false);
    assert.equal(result.message.includes("private"), false);
    assert.equal(action.refreshes, 0);
  }
  const oldSchema = actionHarness({
    response: {
      data: null,
      error: { code: "23514", message: "leads_follow_up_matches_status" },
    },
  });
  assert.ok(
    (await oldSchema.updateLead(leadId, form())).message.includes(
      "migrację etapu 3B",
    ),
  );
  const saved = actionHarness({ cacheError: true });
  const result = await saved.updateLead(leadId, form());
  assert.equal(result.ok, true);
  assert.equal(result.revalidated, undefined);
});

test("DELETE sprawdza właściciela, zamknięty status i wersję atomowo oraz odświeża trzy widoki", async () => {
  for (const status of ["won", "lost"]) {
    const action = actionHarness({ databaseLead: lead({ user_id: owner, status }) });
    const result = await action.deleteLead(leadId, version);
    assert.equal(result.ok, true);
    assert.equal(result.revalidated, true);
    assert.deepEqual(JSON.parse(JSON.stringify(action.calls)), [
      ["schema", "public"],
      ["from", "leads"],
      ["delete"],
      ["eq", "id", leadId],
      ["eq", "user_id", owner],
      ["eq", "updated_at", version],
      ["in", "status", ["won", "lost"]],
      ["select", "id"],
      ["maybeSingle"],
    ]);
    assert.equal(action.refreshes, 3);
  }
});

test("bezpośrednia akcja odrzuca każdy aktywny status, cudzy rekord i nieaktualne potwierdzenie", async () => {
  const saved = lead({ user_id: owner, status: "won" });
  for (const databaseLead of [
    ...LEAD_STATUSES.filter(({ value }) => !["won", "lost"].includes(value))
      .map(({ value }) => ({ ...saved, status: value })),
    { ...saved, user_id: otherId },
    { ...saved, updated_at: "2026-11-19T12:00:00.123457+00:00" },
    null,
  ]) {
    const action = actionHarness({ databaseLead });
    assert.equal((await action.deleteLead(leadId, version)).ok, false);
    assert.equal(action.refreshes, 0);
  }
});

test("DELETE odrzuca brak sesji lub błędne dane i nie ujawnia błędów Supabase", async () => {
  for (const [claims, id, expectedVersion] of [
    [null, leadId, version],
    [{ sub: owner }, "invalid", version],
    [{ sub: owner }, leadId, "invalid"],
  ]) {
    const action = actionHarness({ claims });
    assert.equal((await action.deleteLead(id, expectedVersion)).ok, false);
    assert.equal(action.calls.length, 0);
  }

  for (const response of [
    new Error("private network detail"),
    { data: null, error: { code: "42501", message: "private policy detail" } },
  ]) {
    const action = actionHarness({ response });
    const result = await action.deleteLead(leadId, version);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /private/);
    if (!(response instanceof Error)) assert.match(result.message, /uprawnień/);
    assert.equal(action.refreshes, 0);
  }

  const action = actionHarness({ cacheError: true });
  const result = await action.deleteLead(leadId, version);
  assert.equal(result.ok, true);
  assert.equal(result.revalidated, false);
  assert.equal(action.refreshes, 3);
});

// Kontroler z atrapami hooków i DOM: nie zastępuje testu przeglądarki ani RLS na bazie.
function panelHarness({
  read = async () => ({ ok: true, lead: lead() }),
  write = async () => ({ ok: true, lead: lead() }),
  remove = async () => ({ ok: true, revalidated: true }),
  preferRevalidation = false,
} = {}) {
  const React = require("react");
  const hooks = [],
    effects = [],
    tasks = [],
    frames = [];
  const listeners = new Map();
  let cursor = 0,
    tree,
    closed = 0,
    refreshes = 0,
    confirms = 0,
    confirmation = false;
  const fakeDocument = { body: { style: { overflow: "auto" } } };
  const fakeWindow = {
    confirm() {
      confirms++;
      return confirmation;
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };
  const fakeReact = {
    ...React,
    useRef(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: value };
      return hooks[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks))
        hooks[index] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] =
            typeof value === "function" ? value(hooks[index]) : value;
        },
      ];
    },
    useEffect(callback, deps) {
      const index = cursor++,
        previous = hooks[index];
      if (
        !previous ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      ) {
        hooks[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = callback();
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
    if (Array.isArray(node)) return node.flatMap(nodes);
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
    },
    querySelector() {
      return { focus() {} };
    },
  };
  const deleteDialog = { ...dialog };
  class TestFormData extends FormData {
    constructor(source) {
      super();
      for (const [name, value] of source.entries()) this.set(name, value);
    }
  }
  const { LeadPanel } = loadModule(
    "src/components/pipeline/lead-panel.tsx",
    {
      react: fakeReact,
      "next/navigation": {
        useRouter: () => ({
          refresh() {
            refreshes++;
          },
        }),
      },
      "@/app/actions/leads": {
        getLeadDetails(id) {
          const task = Promise.resolve(read(id));
          tasks.push(task);
          return task;
        },
        updateLead: write,
        deleteLead: remove,
      },
    },
    {
      document: fakeDocument,
      window: fakeWindow,
      FormData: TestFormData,
      requestAnimationFrame: (callback) => frames.push(callback),
    },
  );
  function render() {
    cursor = 0;
    tree = LeadPanel({
      leadId,
      companyName: "Nazwa z karty",
      preferRevalidation,
      onClose() {
        closed++;
      },
    });
    find((node) => node.type === "dialog").props.ref.current = dialog;
    const confirmation = find((node) => node.props?.["aria-labelledby"] === "lead-delete-title");
    if (confirmation) confirmation.props.ref.current = deleteDialog;
    for (const node of nodes(tree))
      if (node.props?.ref && node.type !== "dialog")
        node.props.ref.current = { focus() {} };
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  render();
  return {
    find,
    render,
    dialog,
    deleteDialog,
    listeners,
    clickSurface({
      x = 100,
      y = 200,
      child = false,
      left = 600,
      right = 1200,
    } = {}) {
      const currentTarget = {
        getBoundingClientRect: () => ({ left, right, top: 0, bottom: 800 }),
      };
      find((node) => node.type === "dialog").props.onClick({
        target: child ? {} : currentTarget,
        currentTarget,
        clientX: x,
        clientY: y,
      });
      render();
    },
    async settle() {
      await Promise.allSettled(tasks);
      await Promise.resolve();
      render();
      frames.splice(0).forEach((callback) => callback());
    },
    change(name, value) {
      find(
        (node) =>
          node.props?.name === name &&
          typeof node.props.onChange === "function",
      ).props.onChange({ target: { value } });
      render();
    },
    click(label) {
      find(
        (node) => node.type === "button" && node.props.children === label,
      ).props.onClick();
      render();
    },
    close() {
      find(
        (node) => node.props?.["aria-label"] === "Zamknij panel leada",
      ).props.onClick();
      render();
    },
    submit() {
      const data = new FormData();
      for (const node of nodes(tree))
        if (node.props?.name && "value" in node.props)
          data.set(node.props.name, node.props.value);
      find((node) => node.type === "form").props.onSubmit({
        preventDefault() {},
        currentTarget: data,
      });
      render();
    },
    unmount() {
      for (const hook of hooks) hook?.cleanup?.();
    },
    confirm(value) {
      confirmation = value;
    },
    get closed() {
      return closed;
    },
    get refreshes() {
      return refreshes;
    },
    get confirms() {
      return confirms;
    },
    get overflow() {
      return fakeDocument.body.style.overflow;
    },
  };
}

test("po zapisie w Kalendarzu panel unika drugiego odczytu i odświeża trasę tylko w razie błędu rewalidacji", async () => {
  for (const revalidated of [true, undefined]) {
    const ui = panelHarness({
      preferRevalidation: true,
      write: async () => ({ ok: true, lead: lead({ follow_up_date: "2027-01-02" }), revalidated }),
    });
    await ui.settle();
    ui.change("company_name", "Zmieniona nazwa");
    ui.submit();
    await ui.settle();
    assert.equal(ui.refreshes, revalidated ? 0 : 1);
    assert.equal(ui.closed, 0);
    ui.unmount();
  }
});

test("Usuń leada jest dostępne wyłącznie dla zapisanego statusu won lub lost", async () => {
  for (const status of LEAD_STATUSES) {
    const ui = panelHarness({ read: async () => ({ ok: true, lead: lead({ status: status.value }) }) });
    await ui.settle();
    const findDelete = () => ui.find((node) => node.type === "button" && node.props.children === "Usuń leada");
    const closed = ["won", "lost"].includes(status.value);
    assert.equal(Boolean(findDelete()), closed);
    if (!closed) {
      ui.change("status", "won");
      assert.equal(findDelete(), undefined);
    }
    ui.unmount();
  }
});

test("Anuluj i Escape zamykają potwierdzenie, zachowując panel i szkic", async () => {
  let deletions = 0;
  const ui = panelHarness({
    read: async () => ({ ok: true, lead: lead({ status: "won" }) }),
    remove: async () => { deletions++; return { ok: true, revalidated: true }; },
  });
  await ui.settle();
  ui.change("company_name", "Niezapisany szkic");
  ui.click("Usuń leada");
  assert.equal(ui.deleteDialog.open, true);
  const description = ui.find((node) => node.props?.id === "lead-delete-description");
  assert.match(renderToStaticMarkup(description), /Nazwa z rekordu.*aktywności.*nie można cofnąć/);
  assert.equal(ui.find((node) => node.props?.children === "Anuluj").props.autoFocus, true);
  const confirm = ui.find((node) => node.type === "button" && node.props.children === "Usuń na stałe");
  assert.match(renderToStaticMarkup(confirm), /style="background-color:#991b1b"/);
  assert.equal(confirm.props.disabled, false);
  ui.click("Anuluj");
  assert.equal(ui.deleteDialog.open, false);
  ui.click("Usuń leada");
  let stopped = false;
  ui.find((node) => node.props?.["aria-labelledby"] === "lead-delete-title").props.onCancel({
    preventDefault() {},
    stopPropagation() { stopped = true; },
  });
  assert.equal(stopped, true);
  assert.equal(ui.deleteDialog.open, false);
  assert.equal(ui.closed, 0);
  assert.equal(ui.find((node) => node.type === "input" && node.props.name === "company_name").props.value, "Niezapisany szkic");
  assert.equal(deletions, 0);
  ui.unmount();
});

test("potwierdzenie blokuje wielokrotne kliknięcie, zachowuje panel po błędzie i zamyka go po sukcesie", async () => {
  for (const revalidated of [true, false]) {
    let complete;
    const calls = [];
    const ui = panelHarness({
      read: async () => ({ ok: true, lead: lead({ status: "lost" }) }),
      remove: (id, expectedVersion) => {
        calls.push([id, expectedVersion]);
        return new Promise((resolve) => { complete = resolve; });
      },
    });
    await ui.settle();
    ui.click("Usuń leada");
    const confirm = ui.find((node) => node.props?.children === "Usuń na stałe").props.onClick;
    confirm();
    confirm();
    ui.render();
    assert.deepEqual(calls, [[leadId, version]]);
    assert.equal(ui.find((node) => node.props?.children === "Usuwanie…").props.disabled, true);
    ui.click("Anuluj");
    assert.equal(ui.deleteDialog.open, true);
    complete({ ok: false, message: "Nie masz uprawnień do usunięcia leada." });
    await ui.settle();
    assert.equal(ui.closed, 0);
    assert.equal(ui.deleteDialog.open, true);
    assert.match(ui.find((node) => node.props?.role === "alert").props.children, /uprawnień/);
    assert.equal(ui.refreshes, 0);

    ui.click("Usuń na stałe");
    complete({ ok: true, revalidated });
    await ui.settle();
    assert.equal(calls.length, 2);
    assert.equal(ui.closed, 1);
    assert.equal(ui.deleteDialog.open, false);
    assert.equal(ui.refreshes, revalidated ? 0 : 1);
    ui.unmount();
  }
});

test("panel ładuje pełne dane bez przepisywania i pokazuje daty tylko do odczytu", async () => {
  const ui = panelHarness({
    read: async () => ({
      ok: true,
      lead: lead({
        last_contact_at: "2026-11-17T13:00:00Z",
        notes: "Sklep",
      }),
    }),
  });
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.overflow, "hidden");
  await ui.settle();
  const html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Nazwa z rekordu"));
  assert.ok(html.includes("Ostatni kontakt"));
  assert.ok(html.includes("Sklep"));
  assert.equal((html.match(/ required=""/g) || []).length, 1);
  for (const field of Object.keys(details.leadEditValues(lead())))
    assert.ok(html.includes(`name="${field}"`));
  for (const field of ["id", "user_id", "created_at", "last_contact_at"])
    assert.equal(html.includes(`name="${field}"`), false);
  assert.ok(html.includes("max-w-xl"));
  ui.close();
  assert.equal(ui.closed, 1);
  assert.equal(ui.confirms, 0);
  ui.unmount();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.overflow, "auto");
});

test("kliknięcie przyciemnionego tła zamyka panel przez wspólną logikę", async () => {
  const ui = panelHarness();
  await ui.settle();
  ui.clickSurface();
  assert.equal(ui.closed, 1);
  assert.equal(ui.confirms, 0);
  ui.unmount();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.overflow, "auto");
});

test("kliknięcia treści i pustego miejsca wewnątrz panelu nie zamykają go na desktopie ani telefonie", async () => {
  for (const bounds of [
    { left: 600, right: 1200 },
    { left: 0, right: 390 },
  ]) {
    const ui = panelHarness();
    await ui.settle();
    ui.change("notes", "Niezapisana treść");
    ui.clickSurface({ ...bounds, x: bounds.left + 20, child: true });
    ui.clickSurface({ ...bounds, x: bounds.left + 20 });
    ui.clickSurface({ ...bounds, x: bounds.left });
    assert.equal(ui.closed, 0);
    assert.equal(ui.confirms, 0);
    ui.unmount();
  }
});

test("overlay ostrzega o niezapisanych zmianach, anulowanie zachowuje dane, a potwierdzenie zamyka", async () => {
  const ui = panelHarness();
  await ui.settle();
  ui.change("notes", "Niezapisana treść");
  ui.clickSurface();
  assert.equal(ui.closed, 0);
  assert.equal(ui.confirms, 1);
  assert.equal(
    ui.find((node) => node.props?.name === "notes" && "value" in node.props)
      .props.value,
    "Niezapisana treść",
  );
  ui.confirm(true);
  ui.clickSurface();
  assert.equal(ui.closed, 1);
  assert.equal(ui.confirms, 2);
  ui.unmount();
});

test("Escape i zamknięcie ostrzegają o niezapisanych zmianach; cofnięcie zmian usuwa ostrzeżenie", async () => {
  const ui = panelHarness();
  await ui.settle();
  ui.change("company_name", "Zmieniona nazwa");
  assert.equal(ui.listeners.has("beforeunload"), true);
  let prevented = false;
  ui.find((node) => node.type === "dialog").props.onCancel({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(ui.closed, 0);
  assert.equal(ui.confirms, 1);
  ui.close();
  assert.equal(ui.closed, 0);
  ui.change("company_name", "Nazwa z rekordu");
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.change("next_step", "Rozmowa");
  ui.confirm(true);
  ui.close();
  assert.equal(ui.closed, 1);
  ui.unmount();
});

test("błąd zachowuje wszystkie pola; ponowienie zapisuje i odświeża Pipeline bez zamykania panelu", async () => {
  let attempts = 0,
    submitted;
  const ui = panelHarness({
    write: async (id, data) => {
      assert.equal(id, leadId);
      attempts++;
      submitted = Object.fromEntries(data);
      return attempts === 1
        ? { ok: false, message: "Ponów zapis" }
        : { ok: true, lead: lead({ ...submitted, estimated_value: 1250.5 }) };
    },
  });
  await ui.settle();
  const changes = {
    company_name: "Zmieniona",
    instagram: "@nowy",
    email: "a@example.invalid",
    phone: "123",
    status: "proposal",
    service_type: "Sklep",
    estimated_value: "1250,50",
    next_step: "Rozmowa",
    notes: "Sprzedaż\nTermin",
  };
  for (const [field, value] of Object.entries(changes)) ui.change(field, value);
  ui.submit();
  await ui.settle();
  for (const [field, value] of Object.entries(changes))
    assert.equal(
      ui.find((node) => node.props?.name === field && "value" in node.props)
        .props.value,
      value,
    );
  assert.equal(
    ui.find((node) => node.props?.role === "alert").props.children,
    "Ponów zapis",
  );
  assert.equal(ui.refreshes, 0);
  ui.submit();
  await ui.settle();
  assert.equal(ui.refreshes, 1);
  assert.equal(ui.closed, 0);
  assert.equal(ui.listeners.has("beforeunload"), false);
  assert.equal(
    ui.find((node) => node.props?.role === "status").props.children,
    "Zmiany zostały zapisane.",
  );
  assert.equal(
    ui.find((node) => node.type === "button" && node.props.type === "submit")
      .props.disabled,
    true,
  );
  ui.close();
  assert.equal(ui.confirms, 0);
  ui.unmount();
});

test("w trakcie zapisu formularz, ponowne wysłanie i zamknięcie są zablokowane", async () => {
  let resolve,
    calls = 0;
  const response = new Promise((done) => {
    resolve = done;
  });
  const ui = panelHarness({
    write() {
      calls++;
      return response;
    },
  });
  await ui.settle();
  ui.change("company_name", "Nowa");
  ui.submit();
  ui.submit();
  ui.close();
  assert.equal(calls, 1);
  assert.equal(ui.closed, 0);
  ui.clickSurface();
  assert.equal(ui.closed, 0);
  assert.equal(
    ui.find((node) => node.type === "fieldset").props.disabled,
    true,
  );
  ui.find((node) => node.type === "dialog").props.onCancel({
    preventDefault() {},
  });
  assert.equal(ui.closed, 0);
  resolve({ ok: false, message: "Błąd" });
  await ui.settle();
  ui.unmount();
});

test("panel używa kalendarza i szybkich dat, czyści termin i blokuje datę dla won/lost", async () => {
  const ui = panelHarness();
  await ui.settle();
  for (const label of ["Dziś", "Jutro", "+3 dni", "+7 dni"]) {
    ui.click(label);
    assert.match(
      ui.find((node) => node.props?.name === "follow_up_date").props.value,
      /^\d{4}-\d{2}-\d{2}$/,
    );
  }
  ui.find(
    (node) => node.props?.["aria-controls"] === "lead-edit-calendar",
  ).props.onClick();
  ui.render();
  let escapePrevented = false;
  ui.find((node) => node.type === "dialog").props.onKeyDown({
    key: "Escape",
    preventDefault() {
      escapePrevented = true;
    },
    stopPropagation() {},
  });
  ui.render();
  assert.equal(escapePrevented, true);
  assert.equal(ui.closed, 0);
  assert.equal(
    ui.find(
      (node) =>
        typeof node.type === "function" &&
        node.type.name === "FollowUpCalendar",
    ),
    undefined,
  );
  ui.find(
    (node) => node.props?.["aria-controls"] === "lead-edit-calendar",
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
  for (const status of ["won", "lost"]) {
    ui.click("Jutro");
    ui.change("status", status);
    assert.equal(
      ui.find((node) => node.props?.name === "follow_up_date").props.value,
      "",
    );
    assert.equal(
      ui.find((node) => node.props?.["aria-controls"] === "lead-edit-calendar"),
      undefined,
    );
    ui.change("status", "new");
    assert.equal(
      ui.find((node) => node.props?.name === "follow_up_date").props.value,
      "",
    );
  }
  ui.unmount();
});

test("błąd odczytu nie otwiera pustego formularza; ponowienie pobiera dane", async () => {
  let attempts = 0;
  const ui = panelHarness({
    read: async () =>
      ++attempts === 1
        ? { ok: false, message: "Brak dostępu lub błąd" }
        : { ok: true, lead: lead() },
  });
  await ui.settle();
  assert.equal(
    ui.find((node) => node.type === "form"),
    undefined,
  );
  assert.equal(
    ui.find((node) => node.props?.role === "alert").props.children,
    "Brak dostępu lub błąd",
  );
  ui.click("Spróbuj ponownie");
  await ui.settle();
  assert.ok(ui.find((node) => node.type === "form"));
  ui.unmount();
});

test("kliknięcie karty otwiera jeden panel; zamknięcie oddaje fokus karcie także po zmianie kolumny", () => {
  const React = require("react"),
    hooks = [],
    frames = [];
  let cursor = 0,
    focusedId;
  const fakeReact = {
    ...React,
    useEffect() {},
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (next) => {
          hooks[index] = next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
  };
  const { PipelineBoard } = loadModule(
    "src/components/pipeline/pipeline-board.tsx",
    {
      react: fakeReact,
      "next/navigation": { useRouter: () => ({ refresh() {} }) },
      "@dnd-kit/core": {
        useSensor: (sensor, options) => ({ sensor, options }),
        useSensors: (...sensors) => sensors,
      },
      "@/app/actions/leads": {},
    },
    {
      document: {
        getElementById(id) {
          return {
            focus() {
              focusedId = id;
            },
          };
        },
      },
      requestAnimationFrame(callback) {
        frames.push(callback);
      },
    },
  );
  const { LeadCard } = loadModule("src/components/pipeline/lead-card.tsx");
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function render(rows) {
    cursor = 0;
    return nodes(PipelineBoard({ leads: rows }));
  }
  let rendered = render([lead()]);
  const column = rendered.find((node) => node.props?.status?.value === "new");
  const card = LeadCard({
    lead: lead(),
    status: LEAD_STATUSES[0],
    today: "2026-11-17",
    onOpen: column.props.onOpenLead,
  });
  const button = nodes(card).find((node) => node.type === "button");
  assert.equal(button.props["aria-haspopup"], "dialog");
  assert.equal(button.props["aria-label"], "Otwórz leada: Nazwa z rekordu");
  button.props.onClick();
  rendered = render([lead()]);
  assert.equal(
    rendered.filter((node) => node.type?.name === "LeadPanel").length,
    1,
  );
  rendered = render([lead({ status: "won" })]);
  rendered.find((node) => node.type?.name === "LeadPanel").props.onClose();
  rendered = render([lead({ status: "won" })]);
  assert.equal(
    rendered.some((node) => node.type?.name === "LeadPanel"),
    false,
  );
  frames.forEach((callback) => callback());
  assert.equal(focusedId, `lead-card-${leadId}`);
});

test("notatki ostrzegają przed zamknięciem, a przywrócenie zapisanej treści usuwa ostrzeżenie", async () => {
  const ui = panelHarness({
    read: async () => ({ ok: true, lead: lead({ notes: "Zapisana treść" }) }),
  });
  await ui.settle();
  ui.change("notes", "Edytowana treść");
  ui.close();
  assert.equal(ui.closed, 0);
  assert.equal(ui.confirms, 1);
  assert.equal(
    ui.find((node) => node.props?.name === "notes" && "value" in node.props)
      .props.value,
    "Edytowana treść",
  );
  ui.change("notes", "Zapisana treść");
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.close();
  assert.equal(ui.closed, 1);
  ui.unmount();
});

test("panel ma jedno pole Notatki, jeden zapis i nie renderuje dawnej historii ani ukrytych pól", async () => {
  let submitted;
  const ui = panelHarness({
    read: async () => ({
      ok: true,
      lead: lead({ notes: "Treść do usunięcia" }),
    }),
    write: async (id, data) => {
      assert.equal(id, leadId);
      submitted = Object.fromEntries(data);
      return { ok: true, lead: lead({ notes: null }) };
    },
  });
  await ui.settle();
  let html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Notatki"));
  assert.equal((html.match(/<form\b/g) ?? []).length, 1);
  assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  for (const text of [
    "Potrzeby klienta",
    "Obawy klienta",
    "Historia kontaktów",
    "Zapisz kontakt",
    'name="client_needs"',
    'name="client_concerns"',
  ])
    assert.equal(html.includes(text), false);
  assert.ok(html.includes('form="lead-edit-form"'));
  ui.change("notes", "");
  ui.submit();
  await ui.settle();
  assert.equal(submitted.notes, "");
  assert.equal("client_needs" in submitted, false);
  assert.equal("client_concerns" in submitted, false);
  assert.equal(
    ui.find((node) => node.props?.name === "notes" && "value" in node.props)
      .props.value,
    "",
  );
  assert.equal(ui.refreshes, 1);
  assert.equal(ui.closed, 0);
  html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Zmiany zostały zapisane."));
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.unmount();
});

test("zapis i ponowny odczyt zachowują notatki; wyczyszczenie daje NULL bez zmian dawnych danych", async () => {
  const stored = {
    ...lead(),
    client_needs: "Istniejące potrzeby",
    client_concerns: "Istniejące obawy",
  };
  let update = null;
  const builder = {};
  for (const method of ["schema", "select", "eq", "maybeSingle"])
    builder[method] = () => builder;
  builder.from = (table) => {
    assert.equal(table, "leads", "Edycja notatek nie może zapisywać historii");
    return builder;
  };
  builder.update = (payload) => {
    update = payload;
    return builder;
  };
  builder.overrideTypes = async () => {
    if (update) {
      Object.assign(stored, update);
      update = null;
    }
    return { data: { ...stored }, error: null };
  };
  const actions = loadModule("src/app/actions/leads.ts", {
    "@/lib/auth/session": {
      getAuthenticatedClaims: async () => ({ sub: owner }),
    },
    "@/lib/supabase/server": { createClient: async () => builder },
    "next/cache": { revalidatePath() {} },
  });
  assert.equal((await actions.getLeadDetails(leadId)).lead.notes, null);
  assert.equal(
    (
      await actions.updateLead(
        leadId,
        form({
          notes: "  Pierwsza linia\nDruga linia  ",
          client_needs: "",
          client_concerns: "",
        }),
      )
    ).ok,
    true,
  );
  assert.equal(
    (await actions.getLeadDetails(leadId)).lead.notes,
    "Pierwsza linia\nDruga linia",
  );
  for (const notes of ["", " \t\n"]) {
    assert.equal((await actions.updateLead(leadId, form({ notes }))).ok, true);
    assert.equal((await actions.getLeadDetails(leadId)).lead.notes, null);
  }
  assert.equal(stored.client_needs, "Istniejące potrzeby");
  assert.equal(stored.client_concerns, "Istniejące obawy");
});

test("brak kolumny notes daje czytelną informację o migracji bez ujawniania SQL", async () => {
  for (const code of ["42703", "PGRST204"]) {
    const action = actionHarness({
      response: {
        data: null,
        error: { code, message: "missing column notes" },
      },
    });
    assert.ok((await action.getLeadDetails(leadId)).message.includes("4C"));
    assert.ok(
      (
        await action.updateLead(leadId, form({ notes: "Tekst" }))
      ).message.includes("4C"),
    );
  }
});

test("konflikt zachowuje szkic i wersję; odświeżenie wymaga zgody i następny zapis używa nowej wersji", async () => {
  const message = "Dane tego klienta zostały zmienione w innym oknie. Odśwież je przed zapisem.";
  const freshVersion = "2026-11-19T12:00:00.123457+00:00";
  let reads = 0;
  const submitted = [];
  const ui = panelHarness({
    read: async () => ({ ok: true, lead: ++reads === 1 ? lead() : lead({ notes: "Nowsze dane", updated_at: freshVersion }) }),
    write: async (_id, data) => {
      submitted.push(Object.fromEntries(data));
      return submitted.length === 1
        ? { ok: false, conflict: true, message }
        : { ok: true, lead: lead({ notes: data.get("notes"), updated_at: "2026-11-19T12:00:00.123458+00:00" }) };
    },
  });
  await ui.settle();
  ui.change("notes", "Mój niezapisany szkic");
  ui.submit();
  await ui.settle();
  assert.equal(submitted[0].expected_updated_at, version);
  assert.equal(ui.find((n) => n.props?.name === "notes" && "value" in n.props).props.value, "Mój niezapisany szkic");
  assert.equal(ui.find((n) => n.props?.role === "alert").props.children, message);
  assert.equal(ui.listeners.has("beforeunload"), true);
  ui.submit();
  assert.equal(submitted.length, 1, "Konflikt nie może ponawiać zapisu starego szkicu");
  ui.click("Odśwież dane");
  await ui.settle();
  assert.equal(ui.confirms, 1);
  assert.equal(reads, 1, "Anulowane potwierdzenie nie może pobrać/zastąpić danych");
  assert.equal(ui.find((n) => n.props?.name === "notes" && "value" in n.props).props.value, "Mój niezapisany szkic");
  ui.confirm(true);
  ui.click("Odśwież dane");
  await ui.settle();
  assert.equal(ui.find((n) => n.props?.name === "notes" && "value" in n.props).props.value, "Nowsze dane");
  assert.equal(ui.listeners.has("beforeunload"), false);
  ui.change("notes", "Świadoma zmiana po odświeżeniu");
  ui.submit();
  await ui.settle();
  assert.equal(submitted[1].expected_updated_at, freshVersion);
  assert.equal(ui.closed, 0);
  assert.equal(ui.find((n) => n.props?.role === "status").props.children, "Zmiany zostały zapisane.");
  ui.change("notes", "Kolejna edycja po udanym zapisie");
  ui.submit();
  await ui.settle();
  assert.equal(submitted[2].expected_updated_at, "2026-11-19T12:00:00.123458+00:00");
  ui.unmount();
});

test("błąd odświeżania po konflikcie nie usuwa szkicu i nadal blokuje zapis starej wersji", async () => {
  let reads = 0, writes = 0;
  const ui = panelHarness({
    read: async () => ++reads === 1 ? { ok: true, lead: lead() } : { ok: false, message: "Brak połączenia" },
    write: async () => {
      writes++;
      return { ok: false, conflict: true, message: "Konflikt" };
    },
  });
  await ui.settle();
  ui.change("notes", "Szkic do zachowania");
  ui.submit();
  await ui.settle();
  ui.confirm(true);
  ui.click("Odśwież dane");
  await ui.settle();
  assert.equal(ui.find((n) => n.props?.name === "notes" && "value" in n.props).props.value, "Szkic do zachowania");
  assert.equal(ui.find((n) => n.props?.role === "alert").props.children, "Brak połączenia");
  ui.submit();
  assert.equal(writes, 1);
  assert.equal(ui.closed, 0);
  ui.unmount();
});
