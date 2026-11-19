import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url),
  root = path.resolve(import.meta.dirname, "..");
function load(relative, mocks = {}, globals = {}, cache = new Map()) {
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
          return load(
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
const lib = load("src/lib/leads/activities.ts");
const leadId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  owner = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const row = (extra = {}) => ({
  id: requestId,
  lead_id: leadId,
  type: "note",
  content: "Treść",
  channel: null,
  occurred_at: "2026-11-17T12:00:00Z",
  ...extra,
});
const owned = { data: { id: leadId, last_contact_at: null }, error: null };
function form(extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    request_id: requestId,
    type: "note",
    content: " Treść ",
    ...extra,
  }))
    data.set(key, value);
  return data;
}

test("walidacja dopuszcza tylko niepuste notatki i kontakty z poprawnym kanałem", () => {
  const note = lib.validateActivity(
    form({ channel: "phone", occurred_at: "2000-01-01", user_id: owner }),
  );
  assert.equal(note.ok, true);
  assert.equal(note.payload.content, "Treść");
  assert.equal(note.payload.channel, null);
  assert.equal("occurred_at" in note.payload, false);
  assert.equal("user_id" in note.payload, false);
  for (const channel of lib.CONTACT_CHANNELS)
    assert.equal(
      lib.validateActivity(form({ type: "contact", channel: channel.value }))
        .ok,
      true,
    );
  for (const extra of [
    { content: " \t\n" },
    { type: "status_change" },
    { type: "invalid" },
    { request_id: "bad" },
    { type: "contact", channel: "invalid" },
  ])
    assert.equal(lib.validateActivity(form(extra)).ok, false);
});

test("historia używa nazw statusów, obsługuje starszy tekst i bezpiecznie pozostawia zwykłą treść", () => {
  assert.equal(
    lib.activityContent(
      row({
        type: "status_change",
        content: JSON.stringify({
          from_status: "new",
          to_status: "interested",
        }),
      }),
    ),
    "Nowy → Zainteresowany",
  );
  for (const content of [
    "Stary wpis",
    '{"from_status":"unknown","to_status":"won"}',
    "null",
  ])
    assert.equal(
      lib.activityContent(row({ type: "status_change", content })),
      content,
    );
  assert.equal(
    lib.activityContent(row({ content: "<script>tekst</script>" })),
    "<script>tekst</script>",
  );
});

test("scalanie historii usuwa duplikaty ID i sortuje po chwili zdarzenia, nie po strefie tekstu", () => {
  const old = row({ id: "a", occurred_at: "2026-11-17T13:00:00+02:00" });
  const latest = row({ id: "b", occurred_at: "2026-11-17T12:00:00Z" });
  const result = lib.mergeActivities(
    [old, latest],
    [latest, row({ id: "c", occurred_at: latest.occurred_at })],
  );
  assert.deepEqual(
    Array.from(result, (entry) => entry.id),
    ["c", "b", "a"],
  );
});

function actions(responses, claims = { sub: owner }) {
  const calls = [],
    builder = {};
  let offset = 0;
  for (const method of [
    "schema",
    "from",
    "select",
    "eq",
    "order",
    "range",
    "maybeSingle",
    "single",
    "insert",
  ])
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  builder.overrideTypes = async () => {
    const response = responses[offset++];
    assert.ok(response, "Nieoczekiwane żądanie SDK");
    if (response instanceof Error) throw response;
    return response;
  };
  return {
    calls,
    ...load("src/app/actions/activities.ts", {
      "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
      "@/lib/supabase/server": { createClient: async () => builder },
    }),
  };
}

test("brak sesji, obce ID i walidacja blokują odczyt lub zapis przed dostępem do historii", async () => {
  for (const claims of [null, { sub: owner }]) {
    const action = actions([], claims),
      id = claims ? "invalid" : leadId;
    assert.equal((await action.getLeadActivities(id)).ok, false);
    assert.equal((await action.addLeadActivity(id, form())).ok, false);
    assert.equal(action.calls.length, 0);
  }
  const invalid = actions([]);
  assert.equal(
    (await invalid.addLeadActivity(leadId, form({ content: "" }))).ok,
    false,
  );
  assert.equal(invalid.calls.length, 0);
  for (const method of ["getLeadActivities", "addLeadActivity"]) {
    const action = actions([{ data: null, error: null }]);
    assert.equal((await action[method](leadId, form())).ok, false);
    assert.equal(
      action.calls.some(
        ([key, value]) => key === "from" && value === "lead_activities",
      ),
      false,
    );
    assert.ok(
      action.calls.some(
        ([key, column, value]) =>
          key === "eq" && column === "user_id" && value === owner,
      ),
    );
  }
});

test("odczyt jest ograniczony do leada, stronicowany i nie zwraca pustego sukcesu przy błędzie", async () => {
  const action = actions([
    owned,
    { data: [row({ id: "a" })], count: 2, error: null },
    { data: [row({ id: "b" })], count: 2, error: null },
  ]);
  const result = await action.getLeadActivities(leadId);
  assert.equal(result.ok, true);
  assert.equal(result.activities.length, 2);
  assert.equal(
    action.calls.filter(([key, column]) => key === "eq" && column === "lead_id")
      .length,
    2,
  );
  assert.ok(
    action.calls.some(
      ([key, column, options]) =>
        key === "order" &&
        column === "occurred_at" &&
        options.ascending === false,
    ),
  );
  for (const response of [
    { data: null, count: null, error: { message: "private" } },
    { data: [], count: 1, error: null },
  ]) {
    const failed = await actions([owned, response]).getLeadActivities(leadId);
    assert.equal(failed.ok, false);
    assert.equal("activities" in failed, false);
  }
  assert.equal(
    (
      await actions([
        owned,
        { data: [], count: 0, error: null },
      ]).getLeadActivities(leadId)
    ).ok,
    true,
  );
});

test("INSERT ignoruje cudze lead_id i datę klienta; notatka nie zmienia danych leada", async () => {
  const action = actions([owned, { data: row(), error: null }]);
  const result = await action.addLeadActivity(
    leadId,
    form({ lead_id: owner, occurred_at: "2000-01-01", user_id: owner }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.lastContactAt, undefined);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(action.calls.find(([key]) => key === "insert")[1]),
    ),
    {
      id: requestId,
      type: "note",
      content: "Treść",
      channel: null,
      lead_id: leadId,
    },
  );
  assert.equal(
    action.calls.filter(([key, table]) => key === "from" && table === "leads")
      .length,
    1,
  );
});

test("kontakt zapisuje wybrany kanał i odczytuje last_contact_at po istniejącym triggerze", async () => {
  for (const channel of lib.CONTACT_CHANNELS) {
    const contact = row({ type: "contact", channel: channel.value });
    const action = actions([
      owned,
      { data: contact, error: null },
      {
        data: { ...owned.data, last_contact_at: contact.occurred_at },
        error: null,
      },
    ]);
    const result = await action.addLeadActivity(
      leadId,
      form({ type: "contact", channel: channel.value }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.lastContactAt, contact.occurred_at);
    assert.equal(
      action.calls.find(([key]) => key === "insert")[1].channel,
      channel.value,
    );
    assert.equal(
      action.calls.some(([key]) => key === "update"),
      false,
    );
  }
  const future = "2027-01-01T12:00:00Z";
  const action = actions([
    { data: { ...owned.data, last_contact_at: future }, error: null },
    { data: row({ type: "contact", channel: "phone" }), error: null },
    new Error("offline"),
  ]);
  const result = await action.addLeadActivity(
    leadId,
    form({ type: "contact", channel: "phone" }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.lastContactAt, future);
});

test("ponowienie tego samego UUID potwierdza istniejący wpis bez UPDATE/upsert i bez akceptacji kolizji", async () => {
  const conflict = { data: null, error: { code: "23505" } };
  const action = actions([owned, conflict, { data: row(), error: null }]);
  assert.equal((await action.addLeadActivity(leadId, form())).ok, true);
  assert.equal(action.calls.filter(([key]) => key === "insert").length, 1);
  assert.ok(
    action.calls.some(
      ([key, column, value]) =>
        key === "eq" && column === "id" && value === requestId,
    ),
  );
  for (const existing of [
    null,
    row({ content: "Inny wpis" }),
    row({ type: "contact", channel: "phone" }),
  ]) {
    assert.equal(
      (
        await actions([
          owned,
          conflict,
          { data: existing, error: null },
        ]).addLeadActivity(leadId, form())
      ).ok,
      false,
    );
  }
});

test("błędy SDK są po polsku i nie ujawniają szczegółów SQL", async () => {
  for (const response of [
    new Error("private"),
    { data: null, error: { code: "42501", message: "private" } },
  ]) {
    const result = await actions([owned, response]).addLeadActivity(
      leadId,
      form(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.message.includes("private"), false);
  }
});

// Atrapy hooków/DOM testują kontroler, bez przeglądarki i bez zdalnych zapisów.
function historyUI({
  read = async () => ({ ok: true, activities: [] }),
  write = async () => ({ ok: true, activity: row() }),
} = {}) {
  const React = require("react"),
    hooks = [],
    effects = [],
    reads = [],
    writes = [],
    states = [],
    dates = [];
  let cursor = 0,
    tree,
    revision = 0,
    idCount = 0;
  const fakeReact = {
    ...React,
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks))
        hooks[index] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        },
      ];
    },
    useEffect(callback, deps) {
      const index = cursor++,
        old = hooks[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        hooks[index] = { deps, cleanup: old?.cleanup };
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
          writes.push(
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
  const { LeadActivities } = load(
    "src/components/pipeline/lead-activities.tsx",
    {
      react: fakeReact,
      "@/app/actions/activities": {
        getLeadActivities(id) {
          assert.equal(id, leadId);
          const task = Promise.resolve(read());
          reads.push(task);
          return task;
        },
        addLeadActivity: write,
      },
    },
    {
      FormData,
      crypto: {
        randomUUID: () =>
          `dddddddd-dddd-4ddd-dddd-${String(++idCount).padStart(12, "0")}`,
      },
    },
  );
  function render() {
    cursor = 0;
    tree = LeadActivities({
      leadId,
      revision,
      disabled: false,
      onStateChange: (state) => states.push(state),
      onLastContact: (value) => dates.push(value),
    });
    const field = find((node) => node.type === "textarea");
    if (field) field.props.ref.current = { focus() {} };
    effects.splice(0).forEach((callback) => callback());
    return tree;
  }
  render();
  return {
    find,
    render,
    states,
    dates,
    change(text) {
      find((node) => node.type === "textarea").props.onChange({
        target: { value: text },
      });
      render();
    },
    mode(label) {
      find(
        (node) => node.type === "button" && node.props.children === label,
      ).props.onClick();
      render();
    },
    submit() {
      find((node) => node.type === "form").props.onSubmit({
        preventDefault() {},
      });
      render();
    },
    async settle() {
      await Promise.allSettled([...reads, ...writes]);
      await Promise.resolve();
      render();
    },
    async settleWrites() {
      await Promise.allSettled(writes);
      render();
    },
    revision() {
      revision++;
      render();
    },
  };
}

test("błąd zachowuje szkic, ponowienie używa tego samego ID, a sukces natychmiast dodaje jeden wpis", async () => {
  let calls = 0;
  const ids = [];
  const ui = historyUI({
    write: async (id, data) => {
      assert.equal(id, leadId);
      ids.push(data.get("request_id"));
      if (++calls === 1) throw new Error("offline");
      return {
        ok: true,
        activity: row({ id: ids.at(-1), content: data.get("content") }),
      };
    },
  });
  await ui.settle();
  ui.change("Moja notatka");
  ui.submit();
  await ui.settle();
  assert.equal(
    ui.find((node) => node.type === "textarea").props.value,
    "Moja notatka",
  );
  assert.ok(ui.find((node) => node.props?.role === "alert"));
  ui.submit();
  await ui.settle();
  assert.equal(ids[0], ids[1]);
  assert.equal(ui.find((node) => node.type === "textarea").props.value, "");
  const html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Moja notatka"));
  assert.equal((html.match(/<li\b/g) || []).length, 1);
  assert.equal(ui.states.at(-1).dirty, false);
  assert.equal(ui.states.at(-1).saving, false);
});

test("pusty wpis jest blokowany, podczas zapisu nie ma podwójnego wysłania, kontakt odświeża datę", async () => {
  let finish,
    calls = 0;
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  const ui = historyUI({
    write: () => {
      calls++;
      return response;
    },
  });
  await ui.settle();
  ui.submit();
  assert.equal(calls, 0);
  ui.mode("Kontakt");
  ui.change("Rozmowa");
  ui.submit();
  ui.submit();
  assert.equal(calls, 1);
  assert.equal(
    ui.find((node) => node.type === "fieldset").props.disabled,
    true,
  );
  assert.equal(ui.states.at(-1).saving, true);
  finish({
    ok: true,
    activity: row({
      type: "contact",
      channel: "instagram",
      content: "Rozmowa",
    }),
    lastContactAt: "2026-11-17T12:00:00Z",
  });
  await ui.settle();
  assert.deepEqual(ui.dates, ["2026-11-17T12:00:00Z"]);
  assert.ok(renderToStaticMarkup(ui.render()).includes("Instagram"));
});

test("historia pokazuje błąd zamiast pustego stanu i odświeża statusy po zapisie danych leada", async () => {
  let count = 0;
  const event = row({
    type: "status_change",
    content: JSON.stringify({ from_status: "new", to_status: "won" }),
  });
  const ui = historyUI({
    read: async () =>
      ++count === 1
        ? { ok: false, message: "Błąd historii" }
        : { ok: true, activities: [event, event] },
  });
  await ui.settle();
  let html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Błąd historii"));
  assert.equal(html.includes("Nie ma jeszcze wpisów"), false);
  ui.revision();
  await ui.settle();
  html = renderToStaticMarkup(ui.render());
  assert.ok(html.includes("Nowy → Wygrany"));
  assert.equal((html.match(/<li\b/g) || []).length, 1);
});

test("opóźniony odczyt nie usuwa świeżo zapisanego wpisu; szkice trybów pozostają oddzielne", async () => {
  let resolveRead;
  const response = new Promise((resolve) => {
    resolveRead = resolve;
  });
  const ui = historyUI({ read: () => response });
  ui.change("Notatka");
  ui.mode("Kontakt");
  ui.change("Rozmowa");
  ui.mode("Notatka");
  assert.equal(
    ui.find((node) => node.type === "textarea").props.value,
    "Notatka",
  );
  ui.submit();
  await ui.settleWrites();
  assert.equal(
    ui.states.at(-1).dirty,
    true,
    "Niezapisany kontakt nadal wymaga ostrzeżenia",
  );
  resolveRead({ ok: true, activities: [] });
  await ui.settle();
  assert.equal(
    (renderToStaticMarkup(ui.render()).match(/<li\b/g) || []).length,
    1,
  );
});
