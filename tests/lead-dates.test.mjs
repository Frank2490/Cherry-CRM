import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const scenarios = [
  ["2026-11-18T23:30:00Z", ["2026-11-19", "2026-11-20", "2026-11-22", "2026-11-26"]],
  ["2026-11-19T00:30:00Z", ["2026-11-19", "2026-11-20", "2026-11-22", "2026-11-26"]],
  ["2026-06-30T21:59:59Z", ["2026-06-30", "2026-07-01", "2026-07-03", "2026-07-07"]],
  ["2026-06-30T22:00:00Z", ["2026-07-01", "2026-07-02", "2026-07-04", "2026-07-08"]],
  ["2026-12-31T22:59:59Z", ["2026-12-31", "2027-01-01", "2027-01-03", "2027-01-07"]],
  ["2026-12-31T23:00:00Z", ["2027-01-01", "2027-01-02", "2027-01-04", "2027-01-08"]],
  ["2028-02-28T23:30:00Z", ["2028-02-29", "2028-03-01", "2028-03-03", "2028-03-07"]],
  ["2026-03-28T23:30:00Z", ["2026-03-29", "2026-03-30", "2026-04-01", "2026-04-05"]],
  ["2026-03-29T00:59:59Z", ["2026-03-29", "2026-03-30", "2026-04-01", "2026-04-05"]],
  ["2026-03-29T01:00:00Z", ["2026-03-29", "2026-03-30", "2026-04-01", "2026-04-05"]],
  ["2026-10-24T22:30:00Z", ["2026-10-25", "2026-10-26", "2026-10-28", "2026-11-01"]],
  ["2026-10-25T00:30:00Z", ["2026-10-25", "2026-10-26", "2026-10-28", "2026-11-01"]],
  ["2026-10-25T01:30:00Z", ["2026-10-25", "2026-10-26", "2026-10-28", "2026-11-01"]],
];
let instant = scenarios[0][0];
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return new Date(instant).getTime(); }
}

function loadModule(relative, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const object = { exports: {} };
  cache.set(filename, object);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: object, exports: object.exports, Date: Clock,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { body: { style: { overflow: "" } } },
    requestAnimationFrame(callback) { callback(); },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) {
        const base = "src/" + name.slice(2);
        return loadModule([base + ".ts", base + ".tsx"].find((file) =>
          fs.existsSync(path.join(root, file))), mocks, cache);
      }
      return require(name);
    },
  }, { filename });
  return object.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const record = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", company_name: "Klient",
  updated_at: "2026-11-19T00:00:00.123456+00:00", status: "new",
  instagram: "@kontakt", email: null, phone: null, estimated_value: null,
  service_type: null, follow_up_date: null, next_step: null, notes: null,
  created_at: "2026-01-01T00:00:00Z", last_contact_at: "2026-11-18T23:30:00Z",
};

// Wywołujemy rzeczywiste kontrolery formularzy z lokalnymi hookami i odczytem.
// Żaden formularz nie wysyła danych i nie ma połączenia z Supabase.
function uiHarness(file, name, props = {}) {
  const hooks = [], effects = [], tasks = [];
  let cursor = 0, tree;
  const react = {
    ...require("react"),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next) => {
        hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(callback, deps) {
      const index = cursor++, old = hooks[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        hooks[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = callback();
        });
      }
    },
    useTransition: () => [false, () => { throw Error("Nie wykonuj zapisu w teście dat"); }],
  };
  const component = loadModule(file, {
    react,
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/app/actions/leads": {
      getLeadDetails() {
        const task = Promise.resolve({ ok: true, lead: { ...record } });
        tasks.push(task);
        return task;
      },
    },
    "@/app/actions/follow-ups": {},
  })[name];
  const find = (predicate) => nodes(tree).find(predicate);
  function render() {
    cursor = 0;
    tree = component(props);
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  render();
  return {
    find, render,
    click(label) {
      const button = find((node) => node.type === "button" && node.props.children === label);
      assert.ok(button, `Brak przycisku ${label} w ${name}`);
      button.props.onClick();
      render();
    },
    openCalendar() {
      find((node) => node.type === "button" && node.props["aria-controls"]?.includes("calendar"))
        .props.onClick();
      render();
      return find((node) => node.type?.name === "FollowUpCalendar").props;
    },
    async settle() { await Promise.all(tasks); await Promise.resolve(); render(); },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

async function runScenarios() {
  const dates = loadModule("src/lib/leads/dates.ts");
  const pipeline = loadModule("src/lib/leads/pipeline.ts");
  const followUps = loadModule("src/lib/leads/follow-ups.ts");
  const calendar = loadModule("src/lib/leads/calendar.ts");
  const results = [];
  for (const [now, expected] of scenarios) {
    instant = now;
    const today = dates.getTodayInWarsaw();
    assert.equal(today, expected[0], `${process.env.TZ}: ${now}`);
    const originalInstant = new Date(now);
    const quick = [0, 1, 3, 7].map((days) => dates.followUpQuickDate(days, originalInstant));
    assert.equal(originalInstant.toISOString(), now.replace("Z", ".000Z"));
    assert.deepEqual(quick, expected);
    const forms = [
      ["src/components/pipeline/add-lead-dialog.tsx", "AddLeadDialog", {}],
      ["src/components/pipeline/lead-panel.tsx", "LeadPanel", { leadId: record.id, companyName: record.company_name, onClose() {} }],
      ["src/components/follow-ups/follow-up-dialog.tsx", "FollowUpDialog", { lead: record, mode: "complete", onClose() {}, onSaved() {} }],
      ["src/components/follow-ups/follow-up-dialog.tsx", "FollowUpDialog", { lead: record, mode: "reschedule", onClose() {}, onSaved() {} }],
    ];
    for (const [file, name, props] of forms) {
      const ui = uiHarness(file, name, props);
      if (name === "AddLeadDialog") ui.click("+ Dodaj leada");
      await ui.settle();
      if (name === "LeadPanel") {
        const contact = ui.find((node) => node.type === "time" && node.props.dateTime === record.last_contact_at);
        assert.equal(contact.props.children, new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw",
        }).format(new Date(record.last_contact_at)));
      }
      for (const [index, label] of ["Dziś", "Jutro", "+3 dni", "+7 dni"].entries()) {
        ui.click(label);
        assert.equal(ui.find((node) => node.type === "button" && node.props.children === label).props["aria-pressed"], true);
        const selection = ui.openCalendar();
        assert.equal(selection.value, expected[index], `${name}: ${process.env.TZ}: ${now}: ${label}`);
        // Także kalendarz otwarty z każdego formularza musi wskazywać warszawskie Dziś.
        const picker = uiHarness("src/components/pipeline/follow-up-calendar.tsx", "FollowUpCalendar", { ...selection, value: "" });
        const current = picker.find((node) => node.props?.["aria-current"] === "date");
        assert.equal(current.props["aria-label"], dates.calendarDayLabel(today));
        assert.equal(picker.find((node) => node.type === "h3").props.children, dates.calendarMonthLabel(today));
        picker.unmount();
        selection.onSelect("2028-02-29");
        ui.render();
      }
      assert.equal(ui.openCalendar().value, "2028-02-29", "Wybór z kalendarza nie może przesuwać daty");
      ui.unmount();
    }
    const leads = quick.map((date, i) => ({ ...record, id: String(i), follow_up_date: date }));
    const groups = followUps.groupFollowUps(leads, today);
    assert.equal(groups.find((group) => group.key === "today").leads.length, 1);
    assert.equal(groups.find((group) => group.key === "upcoming").leads.length, 3);
    const byDay = calendar.groupCalendarLeads(leads);
    for (const lead of leads) {
      assert.equal(pipeline.isFollowUpOverdue(lead, today), false);
      assert.equal(byDay.get(lead.follow_up_date)[0].id, lead.id);
      assert.equal(pipeline.formatFollowUpDate(lead.follow_up_date), dates.formatFollowUpDate(lead.follow_up_date));
      assert.equal(calendar.calendarDayLabel(lead.follow_up_date), dates.calendarDayLabel(lead.follow_up_date));
    }
    const overdue = { ...record, follow_up_date: dates.followUpQuickDate(-1) };
    assert.equal(pipeline.isFollowUpOverdue(overdue, today), true);
    assert.equal(followUps.groupFollowUps([overdue], today)[0].leads.length, 1);
    results.push(quick);
  }
  return results;
}

if (process.env.CRM_DATES_TEST_CHILD === "1") {
  process.stdout.write(JSON.stringify(await runScenarios()));
} else {
  for (const zone of ["Europe/Warsaw", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"])
    test(`wspólne daty w trzech formularzach, kalendarzach i Pipeline; strefa urządzenia ${zone}`, () => {
      const output = execFileSync(process.execPath, [import.meta.filename], {
        cwd: root,
        env: { ...process.env, TZ: zone, CRM_DATES_TEST_CHILD: "1" },
        encoding: "utf8", timeout: 30_000,
      });
      assert.deepEqual(JSON.parse(output), scenarios.map(([, dates]) => dates));
    });
}
