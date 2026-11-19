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
  const object = { exports: {} };
  cache.set(filename, object);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: object, exports: object.exports, ...globals,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) {
        const base = "src/" + name.slice(2);
        return loadModule([base + ".ts", base + ".tsx"].find((file) => fs.existsSync(path.join(root, file))), mocks, globals, cache);
      }
      return require(name);
    },
  }, { filename });
  return object.exports;
}
const dates = loadModule("src/lib/leads/dates.ts");
const { LeadCard } = loadModule("src/components/pipeline/lead-card.tsx");
const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");
const record = {
  id: "local-only", updated_at: "2026-11-18T12:00:00Z", company_name: "Test lokalny",
  instagram: "@kontakt", phone: null, email: null, service_type: null,
  estimated_value: null, next_step: null, status: "new", follow_up_date: "2026-11-18",
};
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

// Zegar, timery i zdarzenia przeglądarki są lokalne. Akcje serwerowe nie mogą
// być wywołane; sprawdzamy rzeczywiste hooki i kontrolery obu widoków.
function browser(kind = "hook", start = "2026-11-18T22:59:59.750Z", initialToday = "2026-11-18") {
  let now = new Date(start).getTime(), nextTimer = 1, cursor = 0, tree;
  const hooks = [], effects = [], timers = new Map(), windowEvents = new Map(), documentEvents = new Map();
  function add(map, name, fn) {
    const entries = map.get(name) ?? new Set();
    entries.add(fn);
    map.set(name, entries);
  }
  const document = {
    visibilityState: "visible",
    addEventListener(name, fn) { add(documentEvents, name, fn); },
    removeEventListener(name, fn) { documentEvents.get(name)?.delete(fn); },
  };
  const window = {
    setTimeout(fn, delay) {
      assert.ok(delay > 0 && delay <= 25 * 60 * 60 * 1000, `Nieprawidłowy czas: ${delay}`);
      const id = nextTimer++;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { add(windowEvents, name, fn); },
    removeEventListener(name, fn) { windowEvents.get(name)?.delete(fn); },
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const react = {
    ...require("react"),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(callback, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks[index] = { deps, callback, cleanup: previous?.cleanup };
        effects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = callback();
        });
      }
    },
  };
  const noServer = () => assert.fail("Zmiana dnia nie może odpytywać serwera");
  const mocks = {
    react,
    "next/navigation": { useRouter: () => ({ refresh: noServer }) },
    "@/app/actions/leads": { moveLeadStatus: noServer },
    "@/components/pipeline/lead-panel": { LeadPanel() { return null; } },
    "@/components/follow-ups/follow-up-dialog": { FollowUpDialog() { return null; } },
    "@dnd-kit/core": {
      useSensor: () => null, useSensors: () => [],
      DndContext() {}, DragOverlay() {}, MouseSensor() {}, TouchSensor() {}, KeyboardSensor() {},
    },
  };
  const globals = { Date: Clock, window, document, fetch: noServer };
  const cache = new Map();
  const { useTodayInWarsaw } = loadModule("src/lib/leads/use-today-in-warsaw.ts", mocks, globals, cache);
  const component = kind === "hook" ? () => useTodayInWarsaw(initialToday)
    : kind === "pipeline"
      ? loadModule("src/components/pipeline/pipeline-board.tsx", mocks, globals, cache).PipelineBoard
      : loadModule("src/components/follow-ups/follow-ups-list.tsx", mocks, globals, cache).FollowUpsList;
  function render() {
    cursor = 0;
    tree = component({ leads: [record], initialToday });
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  render();
  return {
    render,
    timers,
    setClock(value) { now = new Date(value).getTime(); },
    advance(value) {
      now = new Date(value).getTime();
      for (const [id, timer] of [...timers]) if (timer.due <= now) {
        timers.delete(id);
        timer.fn();
      }
      return render();
    },
    event(name) {
      for (const fn of (name === "visibilitychange" ? documentEvents : windowEvents).get(name) ?? []) fn();
      return render();
    },
    hide() { document.visibilityState = "hidden"; return this.event("visibilitychange"); },
    show() { document.visibilityState = "visible"; return this.event("visibilitychange"); },
    replayEffects() {
      for (const hook of hooks) if (hook?.callback) {
        hook.cleanup?.();
        hook.cleanup = hook.callback();
      }
    },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
    listenerCount() {
      return [...windowEvents.values(), ...documentEvents.values()].reduce((count, set) => count + set.size, 0);
    },
    pipelineHTML() {
      const today = nodes(render()).find((node) => node.props?.status?.value === "new").props.today;
      return renderToStaticMarkup(LeadCard({ lead: record, status: LEAD_STATUSES[0], today }));
    },
    count(section) {
      const group = nodes(render()).find((node) => node.type === "section" && node.props["aria-labelledby"] === `follow-ups-${section}`);
      return nodes(group).filter((node) => node.type === "article").length;
    },
  };
}

const boundaries = [
  ["2026-11-18T22:59:59.750Z", "2026-11-18T23:00:00Z"],
  ["2026-06-30T21:59:59.750Z", "2026-06-30T22:00:00Z"],
  ["2026-12-31T22:59:59.750Z", "2026-12-31T23:00:00Z"],
  ["2028-02-28T22:59:59.750Z", "2028-02-28T23:00:00Z"],
  ["2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z"],
  ["2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z"],
  ["2026-03-29T00:59:59Z", "2026-03-29T22:00:00Z"],
  ["2026-03-29T01:00:00Z", "2026-03-29T22:00:00Z"],
  ["2026-10-25T00:59:59Z", "2026-10-25T23:00:00Z"],
  ["2026-10-25T01:00:00Z", "2026-10-25T23:00:00Z"],
];
for (const zone of ["Europe/Warsaw", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"]) {
  test(`najbliższa warszawska północ: północ, miesiąc, rok, rok przestępny i DST; urządzenie ${zone}`, () => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      for (const [start, midnight] of boundaries) {
        const instant = new Date(start);
        assert.equal(dates.millisecondsUntilNextWarsawDay(instant), new Date(midnight) - instant, start);
        const ui = browser("hook", start, dates.getTodayInWarsaw(instant));
        assert.equal([...ui.timers.values()][0].due, new Date(midnight).getTime());
        assert.equal(ui.advance(midnight), dates.getTodayInWarsaw(new Date(midnight)));
        assert.equal(ui.timers.size, 1);
        ui.unmount();
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
}

test("Pipeline oznacza kartę jako zaległą dokładnie o północy, bez innej interakcji lub żądań", () => {
  const ui = browser("pipeline");
  assert.equal(ui.pipelineHTML().includes("Zaległy"), false);
  ui.advance("2026-11-18T22:59:59.999Z");
  assert.equal(ui.pipelineHTML().includes("Zaległy"), false);
  ui.advance("2026-11-18T23:00:00Z");
  assert.equal(ui.pipelineHTML().includes("Zaległy"), true);
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

test("Follow-upy przenoszą termin z Na dziś do Zaległe o tej samej północy co Pipeline", () => {
  const ui = browser("follow-ups");
  assert.equal(ui.count("today"), 1);
  assert.equal(ui.count("overdue"), 0);
  ui.advance("2026-11-18T23:00:00Z");
  assert.equal(ui.count("today"), 0);
  assert.equal(ui.count("overdue"), 1);
  ui.unmount();
});

for (const event of ["focus", "visibilitychange", "pageshow"]) {
  test(`powrót następnego dnia przez ${event} aktualizuje datę i utrzymuje tylko jeden timer`, () => {
    for (const kind of ["pipeline", "follow-ups"]) {
      const ui = browser(kind);
      ui.setClock("2026-11-20T12:00:00Z"); // Timery w uśpionej karcie nie wykonały się.
      ui.event(event);
      if (kind === "pipeline") assert.equal(ui.pipelineHTML().includes("Zaległy"), true);
      else assert.equal(ui.count("overdue"), 1);
      for (let i = 0; i < 3; i++) ui.event(event);
      assert.equal(ui.timers.size, 1);
      ui.unmount();
    }
  });
}

test("ukryta karta nie utrzymuje timera; po kilku dniach od razu odtwarza właściwą datę", () => {
  const ui = browser();
  ui.hide();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.advance("2026-11-22T12:00:00Z"), "2026-11-18");
  assert.equal(ui.show(), "2026-11-22");
  assert.equal(ui.timers.size, 1);
  ui.unmount();
});

test("data SSR jest korygowana po montażu, także gdy północ minęła podczas ładowania", () => {
  const ui = browser("hook", "2026-11-18T23:00:00Z", "2026-11-18");
  assert.equal(ui.render(), "2026-11-19");
  ui.unmount();
});

test("demontaż oraz ponowienie efektów w Strict Mode sprzątają timery i wszystkie listenery", () => {
  const ui = browser();
  for (let i = 0; i < 3; i++) {
    ui.replayEffects();
    assert.equal(ui.timers.size, 1);
    assert.equal(ui.listenerCount(), 3);
  }
  ui.unmount();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.listenerCount(), 0);
  assert.equal(ui.advance("2026-11-22T12:00:00Z"), "2026-11-18");
});
