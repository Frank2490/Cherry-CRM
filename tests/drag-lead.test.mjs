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

const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");
const { validateLeadMove } = loadModule("src/lib/leads/move.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const leadId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const version = "2026-11-19T12:00:00.123456+00:00";
function lead(overrides = {}) {
  return {
    id: leadId,
    updated_at: version,
    company_name: "Klient",
    instagram: "@kontakt",
    email: null,
    phone: null,
    status: "new",
    service_type: null,
    estimated_value: null,
    follow_up_date: "2026-11-21",
    ...overrides,
  };
}
function input(overrides = {}) {
  return {
    status: "interested",
    expectedUpdatedAt: version,
    expectedStatus: "new",
    expectedFollowUpDate: "2026-11-21",
    clearFollowUpConfirmed: false,
    ...overrides,
  };
}

function actionHarness({
  record = lead(),
  claims = { sub: owner },
  readError = null,
  writeError = null,
  missing = false,
  conflict = false,
  cacheError = false,
  network = false,
} = {}) {
  const stored = {
    ...record,
    notes: "Istniejące notatki",
    next_step: "Rozmowa",
    created_at: "2026-01-01",
    last_contact_at: "2026-11-18T12:00:00Z",
    user_id: owner,
  };
  const calls = [],
    paths = [];
  let payload,
    updating = false;
  const sdk = {};
  for (const name of ["schema", "from", "select", "eq", "is", "maybeSingle"])
    sdk[name] = (...args) => {
      calls.push([name, ...args]);
      return sdk;
    };
  sdk.update = (values) => {
    updating = true;
    payload = values;
    calls.push(["update", values]);
    return sdk;
  };
  sdk.overrideTypes = async () => {
    if (network) throw Error("network");
    if (!updating)
      return {
        data: missing
          ? null
          : {
              id: stored.id,
              updated_at: stored.updated_at,
              status: stored.status,
              follow_up_date: stored.follow_up_date,
            },
        error: readError,
      };
    if (writeError || conflict) return { data: null, error: writeError };
    Object.assign(stored, payload);
    return {
      data: {
        id: stored.id,
        updated_at: stored.updated_at,
        status: stored.status,
        follow_up_date: stored.follow_up_date,
      },
      error: null,
    };
  };
  const actions = loadModule("src/app/actions/leads.ts", {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
    "@/lib/supabase/server": { createClient: async () => sdk },
    "next/cache": {
      revalidatePath(path) {
        paths.push(path);
        if (cacheError) throw Error("cache");
      },
    },
  });
  return { ...actions, calls, paths, stored };
}

test("walidacja przeniesienia odrzuca obce pola zamiast używać ich w zapisie i sprawdza statusy, UUID oraz datę", () => {
  assert.equal(validateLeadMove(leadId, input()), true);
  for (const [id, values] of [
    ["invalid", input()],
    [leadId, null],
    [leadId, input({ status: "invalid" })],
    [leadId, input({ expectedStatus: "invalid" })],
    [leadId, input({ expectedFollowUpDate: "2026-02-29" })],
    [leadId, input({ clearFollowUpConfirmed: "true" })],
  ])
    assert.equal(validateLeadMove(id, values), false);
});
test("wszystkie 49 par statusów: UPDATE tylko przy rzeczywistej zmianie, termin znika wyłącznie dla won/lost", async () => {
  for (const from of LEAD_STATUSES)
    for (const to of LEAD_STATUSES) {
      const date = ["won", "lost"].includes(from.value) ? null : "2026-11-21";
      const api = actionHarness({
        record: lead({ status: from.value, follow_up_date: date }),
      });
      const result = await api.moveLeadStatus(
        leadId,
        input({
          status: to.value,
          expectedStatus: from.value,
          expectedFollowUpDate: date,
          clearFollowUpConfirmed: true,
        }),
      );
      assert.equal(result.ok, true, `${from.value} → ${to.value}`);
      assert.equal(result.lead.status, to.value);
      assert.equal(
        result.lead.follow_up_date,
        ["won", "lost"].includes(to.value) ? null : date,
      );
      const updates = api.calls.filter(([name]) => name === "update");
      assert.equal(updates.length, from.value === to.value ? 0 : 1);
      if (updates.length)
        assert.deepEqual(
          Object.keys(updates[0][1]).sort(),
          ["won", "lost"].includes(to.value)
            ? ["follow_up_date", "status"]
            : ["status"],
        );
    }
});
test("nazwa, kontakty, notatki, kwota i daty kontaktu pozostają niezmienione po zapisie i ponownym odczycie", async () => {
  const api = actionHarness({ record: lead({ estimated_value: 1234.5 }) });
  const snapshot = { ...api.stored };
  const result = await api.moveLeadStatus(
    leadId,
    input({
      user_id: "other-owner",
      id: "other-id",
      notes: "Usuń",
      company_name: "Obca nazwa",
      follow_up_date: null,
      last_contact_at: "2000-01-01",
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(api.stored, { ...snapshot, status: "interested" });
  assert.equal(
    (await api.moveLeadStatus(leadId, input({ expectedStatus: "interested" }))).lead.status,
    "interested",
  );
  assert.deepEqual(api.paths, ["/pipeline", "/follow-ups", "/calendar"]);
});
test("zamknięcie z terminem wymaga potwierdzenia; zamknięcie bez daty go nie wymaga", async () => {
  for (const status of ["won", "lost"]) {
    const blocked = actionHarness();
    const result = await blocked.moveLeadStatus(leadId, input({ status }));
    assert.equal(result.ok, false);
    assert.ok(result.message.includes("Potwierdź"));
    assert.equal(
      blocked.calls.some(([name]) => name === "update"),
      false,
    );
    const allowed = actionHarness({ record: lead({ follow_up_date: null }) });
    assert.equal(
      (
        await allowed.moveLeadStatus(
          leadId,
          input({ status, expectedFollowUpDate: null }),
        )
      ).ok,
      true,
    );
  }
});
test("odczyt i UPDATE filtrują ID i właściciela, a zapis również poprzedni status i termin", async () => {
  for (const date of ["2026-11-21", null]) {
    const api = actionHarness({ record: lead({ follow_up_date: date }) });
    assert.equal(
      (await api.moveLeadStatus(leadId, input({ expectedFollowUpDate: date })))
        .ok,
      true,
    );
    assert.equal(
      api.calls.filter(
        ([name, key, value]) =>
          name === "eq" && key === "id" && value === leadId,
      ).length,
      2,
    );
    assert.equal(
      api.calls.filter(
        ([name, key, value]) =>
          name === "eq" && key === "user_id" && value === owner,
      ).length,
      2,
    );
    assert.ok(
      api.calls.some(
        ([name, key, value]) =>
          name === "eq" && key === "status" && value === "new",
      ),
    );
    assert.ok(
      api.calls.some(
        ([name, key, value]) =>
          name === (date === null ? "is" : "eq") &&
          key === "follow_up_date" &&
          value === date,
      ),
    );
    assert.ok(
      api.calls
        .filter(([name]) => name === "from")
        .every((call) => call[1] === "leads"),
    );
  }
});
test("brak sesji i błędne dane blokują dostęp przed zapytaniem", async () => {
  for (const [options, id, values] of [
    [{ claims: null }, leadId, input()],
    [{}, "invalid", input()],
    [{}, leadId, input({ status: "wrong" })],
  ]) {
    const api = actionHarness(options);
    assert.equal((await api.moveLeadStatus(id, values)).ok, false);
    assert.equal(api.calls.length, 0);
  }
});
test("cudzy lead, odmowa RLS, błąd sieci i konflikt zapisu nie zgłaszają sukcesu", async () => {
  for (const options of [
    { missing: true },
    { readError: { code: "42501" } },
    { writeError: { code: "42501" } },
    { network: true },
    { conflict: true },
  ]) {
    const api = actionHarness(options);
    const result = await api.moveLeadStatus(leadId, input());
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 0);
    assert.equal(api.stored.status, "new");
    assert.equal(api.paths.length, 0);
  }
});
test("nowszy status lub termin nie zostaje nadpisany przez nieaktualne przeciągnięcie", async () => {
  for (const record of [
    lead({ status: "proposal" }),
    lead({ follow_up_date: "2026-12-01" }),
  ]) {
    const api = actionHarness({ record });
    const result = await api.moveLeadStatus(
      leadId,
      input({ status: "won", clearFollowUpConfirmed: true }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true);
    assert.equal(result.message, "Dane tego klienta zostały zmienione w innym oknie. Odśwież je przed zapisem.");
    assert.equal(
      api.calls.some(([name]) => name === "update"),
      false,
    );
  }
});
test("awaria cache po potwierdzonym UPDATE nie sugeruje ponownego zapisu", async () => {
  const api = actionHarness({ cacheError: true });
  assert.equal((await api.moveLeadStatus(leadId, input())).ok, true);
  assert.deepEqual(api.paths, ["/pipeline", "/follow-ups", "/calendar"]);
});

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function boardHarness({
  rows = [lead()],
  write = async (id, values) => ({
    ok: true,
    lead: {
      id,
      updated_at: version,
      status: values.status,
      follow_up_date: ["won", "lost"].includes(values.status)
        ? null
        : values.expectedFollowUpDate,
    },
  }),
  confirmation = true,
  confirmationDelay = 0,
} = {}) {
  const React = require("react"),
    hooks = [],
    frames = [],
    calls = [],
    confirmations = [];
  let cursor = 0,
    tree,
    refreshed = 0,
    focused,
    now = 1000,
    overId = null;
  const react = {
    ...React,
    useEffect() {},
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [
        hooks[i],
        (next) => {
          hooks[i] = typeof next === "function" ? next(hooks[i]) : next;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: initial };
      return hooks[i];
    },
  };
  function DndContext({ children }) {
    return children;
  }
  function DragOverlay({ children }) {
    return children;
  }
  function MouseSensor() {}
  function TouchSensor() {}
  function KeyboardSensor() {}
  const dnd = {
    DndContext,
    DragOverlay,
    MouseSensor,
    TouchSensor,
    KeyboardSensor,
    useSensor: (sensor, options) => ({ sensor, options }),
    useSensors: (...sensors) => sensors,
    useDroppable: ({ id }) => ({ setNodeRef() {}, isOver: id === overId }),
    useDraggable: () => ({
      setNodeRef() {},
      setActivatorNodeRef() {},
      attributes: {},
      listeners: {},
      isDragging: false,
    }),
  };
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const { PipelineBoard } = loadModule(
    "src/components/pipeline/pipeline-board.tsx",
    {
      react,
      "@dnd-kit/core": dnd,
      "next/navigation": {
        useRouter: () => ({
          refresh() {
            refreshed++;
          },
        }),
      },
      "@/app/actions/leads": {
        async moveLeadStatus(id, values) {
          calls.push([id, values]);
          return write(id, values);
        },
      },
    },
    {
      Date: Clock,
      window: {
        confirm(message) {
          now += confirmationDelay;
          confirmations.push(message);
          return confirmation;
        },
      },
      document: {
        getElementById(id) {
          return {
            focus() {
              focused = id;
            },
          };
        },
      },
      requestAnimationFrame(fn) {
        frames.push(fn);
      },
    },
  );
  function render(nextRows = rows) {
    rows = nextRows;
    cursor = 0;
    tree = PipelineBoard({ leads: rows });
    return tree;
  }
  const find = (predicate) => nodes(tree).find(predicate);
  function context() {
    return find((n) => n.type === DndContext).props;
  }
  render();
  return {
    render,
    find,
    calls,
    confirmations,
    context,
    start(id = leadId) {
      context().onDragStart({ active: { id } });
      render();
    },
    async drop(status, id = leadId) {
      const promise = context().onDragEnd({
        active: { id },
        over: status === null ? null : { id: status },
      });
      render();
      await promise;
      render();
    },
    beginDrop(status) {
      const promise = context().onDragEnd({
        active: { id: leadId },
        over: { id: status },
      });
      render();
      return promise;
    },
    cancel() {
      context().onDragCancel({ active: { id: leadId } });
      render();
    },
    open() {
      find((n) => n.props?.status?.value === "new").props.onOpenLead(rows[0]);
      render();
    },
    advance() {
      now += 600;
    },
    hover(id) {
      overId = id;
    },
    flush() {
      frames.splice(0).forEach((fn) => fn());
    },
    get refreshed() {
      return refreshed;
    },
    get focused() {
      return focused;
    },
  };
}
function columnRows(ui, status) {
  return ui.find((n) => n.props?.status?.value === status).props.leads;
}

test("przeciągnięcie i upuszczenie do tej samej kolumny, poza kolumnami lub anulowanie nie zapisuje", async () => {
  for (const status of ["new", null, "invalid"]) {
    const ui = boardHarness();
    ui.start();
    await ui.drop(status);
    assert.equal(ui.calls.length, 0);
    assert.equal(columnRows(ui, "new").length, 1);
  }
  const ui = boardHarness();
  ui.start();
  ui.cancel();
  assert.equal(ui.calls.length, 0);
  ui.flush();
  assert.equal(ui.focused, `lead-card-${leadId}`);
});
test("optymistyczny ruch i blokada wielokrotnego zapisu do czasu odpowiedzi serwera", async () => {
  let resolve;
  const waiting = new Promise((done) => {
    resolve = done;
  });
  const ui = boardHarness({ write: () => waiting });
  ui.start();
  const pending = ui.beginDrop("proposal");
  assert.equal(columnRows(ui, "new").length, 0);
  assert.equal(columnRows(ui, "proposal").length, 1);
  await ui.drop("decision");
  assert.equal(ui.calls.length, 1);
  assert.equal(
    ui.find((n) => n.props?.["aria-label"] === "Pipeline według statusu").props[
      "aria-busy"
    ],
    true,
  );
  ui.open();
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  resolve({
    ok: true,
    lead: { id: leadId, status: "proposal", follow_up_date: "2026-11-21" },
  });
  await pending;
  ui.render();
  assert.equal(ui.refreshed, 1);
  assert.equal(columnRows(ui, "proposal").length, 1);
  ui.render([lead({ status: "proposal" })]);
  ui.render();
  assert.equal(columnRows(ui, "proposal").length, 1);
  ui.render([lead({ status: "new", company_name: "Zmiana w panelu" })]);
  ui.render();
  assert.equal(columnRows(ui, "new")[0].company_name, "Zmiana w panelu");
});
test("odmowa i wyjątek zapisu przywracają poprzednią kolumnę i pokazują polski błąd", async () => {
  for (const write of [
    async () => ({ ok: false, message: "Odmowa zapisu" }),
    async () => {
      throw Error("network");
    },
  ]) {
    const ui = boardHarness({ write });
    ui.start();
    await ui.drop("interested");
    assert.equal(columnRows(ui, "new").length, 1);
    assert.equal(columnRows(ui, "interested").length, 0);
    assert.ok(ui.find((n) => n.props?.role === "alert").props.children);
    assert.equal(ui.refreshed, 0);
  }
});

test("drag & drop przesyła wersję i po konflikcie przywraca kartę oraz udostępnia odświeżenie", async () => {
  const message = "Dane tego klienta zostały zmienione w innym oknie. Odśwież je przed zapisem.";
  const ui = boardHarness({ write: async () => ({ ok: false, conflict: true, message }) });
  ui.start();
  await ui.drop("interested");
  assert.equal(ui.calls[0][1].expectedUpdatedAt, version);
  assert.equal(columnRows(ui, "new").length, 1);
  assert.equal(columnRows(ui, "interested").length, 0);
  assert.equal(ui.find((n) => n.props?.role === "alert").props.children, message);
  ui.find((n) => n.type === "button" && n.props.children === "Odśwież dane").props.onClick();
  ui.render();
  assert.equal(ui.refreshed, 1);
});

test("zmiana danych tablicy w trakcie przeciągania nie podmienia zapamiętanej wersji karty", async () => {
  const ui = boardHarness();
  ui.start();
  ui.render([lead({ updated_at: "2026-11-19T12:00:00.123457+00:00" })]);
  await ui.drop("proposal");
  assert.equal(ui.calls[0][1].expectedUpdatedAt, version);
});
test("przejście won/lost z datą pyta o zgodę i anuluje bez zapisu po odmowie", async () => {
  for (const status of ["won", "lost"]) {
    const denied = boardHarness({ confirmation: false });
    denied.start();
    await denied.drop(status);
    assert.equal(denied.confirmations.length, 1);
    assert.equal(denied.calls.length, 0);
    assert.equal(columnRows(denied, "new").length, 1);
    const accepted = boardHarness();
    accepted.start();
    await accepted.drop(status);
    assert.equal(accepted.calls[0][1].clearFollowUpConfirmed, true);
    assert.equal(columnRows(accepted, status)[0].follow_up_date, null);
    const withoutDate = boardHarness({
      rows: [lead({ follow_up_date: null })],
    });
    withoutDate.start();
    await withoutDate.drop(status);
    assert.equal(withoutDate.confirmations.length, 0);
    assert.equal(columnRows(withoutDate, status)[0].follow_up_date, null);
  }
});
test("zwykłe kliknięcie otwiera panel, ale klik po zakończeniu/anulowaniu przeciągania jest pomijany", async () => {
  const ui = boardHarness();
  ui.open();
  assert.ok(ui.find((n) => n.type?.name === "LeadPanel"));
  ui.find((n) => n.type?.name === "LeadPanel").props.onClose();
  ui.render();
  ui.start();
  ui.open();
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  ui.cancel();
  ui.open();
  assert.equal(
    ui.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
  ui.advance();
  ui.open();
  assert.ok(ui.find((n) => n.type?.name === "LeadPanel"));
  const dropped = boardHarness();
  dropped.start();
  await dropped.drop("new");
  dropped.open();
  assert.equal(
    dropped.find((n) => n.type?.name === "LeadPanel"),
    undefined,
  );
});
test("dłuższa odmowa potwierdzenia również blokuje kliknięcie otwierające panel po upuszczeniu", async () => {
  const ui = boardHarness({ confirmation: false, confirmationDelay: 3000 });
  ui.start();
  await ui.drop("won");
  ui.open();
  assert.equal(ui.calls.length, 0);
  assert.equal(
    ui.find((node) => node.type?.name === "LeadPanel"),
    undefined,
  );
  ui.advance();
  ui.open();
  assert.ok(ui.find((node) => node.type?.name === "LeadPanel"));
});

test("mysz ma próg ruchu, dotyk przytrzymanie, klawiatura Spację i komunikaty po polsku", () => {
  const ui = boardHarness();
  const context = ui.context();
  const sensors = context.sensors;
  assert.equal(sensors[0].sensor.name, "MouseSensor");
  assert.equal(sensors[0].options.activationConstraint.distance, 8);
  assert.equal(sensors[1].sensor.name, "TouchSensor");
  assert.equal(sensors[1].options.activationConstraint.delay, 250);
  assert.equal(sensors[1].options.activationConstraint.tolerance, 8);
  assert.equal(sensors[2].sensor.name, "KeyboardSensor");
  assert.deepEqual(Array.from(sensors[2].options.keyboardCodes.start), [
    "Space",
  ]);
  assert.ok(
    context.accessibility.screenReaderInstructions.draggable.includes(
      "Enter otwiera",
    ),
  );
  assert.ok(
    context.accessibility.announcements.onDragCancel().includes("Anulowano"),
  );
  assert.ok(
    ui
      .find((n) => n.props?.["aria-label"] === "Pipeline według statusu")
      .props.className.includes("overflow-x-auto"),
  );
  ui.start();
  assert.ok(
    ui
      .find((n) => n.props?.["aria-label"] === "Pipeline według statusu")
      .props.className.includes("snap-none"),
  );
  assert.ok(ui.find((n) => n.type?.name === "DragOverlay").props.children);
});
test("klawiatura wybiera kolejno siedem kolumn i nie wychodzi poza skrajne statusy", () => {
  const { pipelineKeyboardCoordinates } = loadModule(
    "src/components/pipeline/pipeline-drag.ts",
  );
  const rects = new Map(
    LEAD_STATUSES.map((s, i) => [
      s.value,
      { left: i * 300, top: 0, width: 288, height: 500 },
    ]),
  );
  for (let i = 0; i < LEAD_STATUSES.length; i++)
    for (const [code, step] of [
      ["ArrowLeft", -1],
      ["ArrowRight", 1],
    ]) {
      const context = {
        over: { id: LEAD_STATUSES[i].value },
        collisionRect: { left: i * 300, top: 0, width: 288, height: 500 },
        droppableRects: rects,
        droppableContainers: new Map(),
      };
      const result = pipelineKeyboardCoordinates(
        { code },
        { context, currentCoordinates: { x: i * 300, y: 0 } },
      );
      if (i + step < 0 || i + step >= LEAD_STATUSES.length)
        assert.equal(result, undefined);
      else assert.equal(result.x, (i + step) * 300);
    }
});
test("podświetlenie kolumny i źródła oraz touch-action zachowują statusowe kolory i przewijanie", () => {
  const React = require("react");
  const { PipelineColumn } = loadModule(
    "src/components/pipeline/pipeline-column.tsx",
    {
      "@dnd-kit/core": {
        useDroppable: () => ({ setNodeRef() {}, isOver: true }),
        useDraggable: () => ({
          setNodeRef() {},
          setActivatorNodeRef() {},
          attributes: {},
          listeners: {},
          isDragging: true,
        }),
      },
    },
  );
  const html = renderToStaticMarkup(
    React.createElement(PipelineColumn, {
      status: LEAD_STATUSES[0],
      leads: [lead()],
      today: "2026-11-18",
      onOpenLead() {},
    }),
  );
  for (const text of [
    "border-top-color:#64748b",
    "border-left-color:#64748b",
    "inset 0 0 0 2px #64748b",
    "opacity-35",
    "touch-manipulation",
    "cursor-grab",
  ])
    assert.ok(html.includes(text));
});
