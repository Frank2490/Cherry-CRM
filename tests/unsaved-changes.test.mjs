import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadModule(relative, host, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const object = { exports: {} };
  cache.set(filename, object);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: object, exports: object.exports, window: host,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) {
        const base = "src/" + name.slice(2);
        return loadModule([base + ".ts", base + ".tsx"].find((file) =>
          fs.existsSync(path.join(root, file))), host, mocks, cache);
      }
      return require(name);
    },
  }, { filename });
  return object.exports;
}

// Model historii i kolejności capture/bubble. Nie uruchamia Next.js ani sieci.
function browser(modern) {
  const listeners = new Map(), navigationListeners = new Map(), pending = [];
  const entries = [{ key: "entry-0", url: "https://crm.test/pipeline", state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { route: "pipeline" } } }];
  let position = 0, nextKey = 1, answer = false;
  const confirmations = [], restored = [], applicationPops = [];
  function add(map, type, callback, capture = false) {
    const set = map.get(type) ?? new Set();
    set.add({ callback, capture });
    map.set(type, set);
  }
  function remove(map, type, callback, capture = false) {
    for (const listener of map.get(type) ?? [])
      if (listener.callback === callback && listener.capture === capture) map.get(type).delete(listener);
  }
  function dispatch(map, type, event) {
    let stopped = false;
    event.stopImmediatePropagation = () => { stopped = true; };
    for (const { callback } of Array.from(map.get(type) ?? []).sort((a, b) => Number(b.capture) - Number(a.capture))) {
      if (stopped) break;
      callback(event);
    }
  }
  const host = {
    confirm(message) { confirmations.push(message); return answer; },
    addEventListener(type, callback, capture = false) { add(listeners, type, callback, capture); },
    removeEventListener(type, callback, capture = false) { remove(listeners, type, callback, capture); },
    location: { get href() { return entries[position].url; } },
    history: {
      get state() { return entries[position].state; },
      get length() { return entries.length; },
      pushState(data, _unused, url) {
        assert.equal(this, host.history);
        entries.splice(position + 1, Infinity, { key: `entry-${nextKey++}`, url: new URL(url ?? host.location.href, host.location.href).href, state: data });
        position++;
        dispatch(navigationListeners, "currententrychange", { navigationType: "push" });
      },
      replaceState(data, _unused, url) {
        assert.equal(this, host.history);
        entries[position] = { ...entries[position], state: data, url: new URL(url ?? host.location.href, host.location.href).href };
        dispatch(navigationListeners, "currententrychange", { navigationType: "replace" });
      },
      go(delta) { restored.push(delta); pending.push(() => traverse(position + delta)); },
    },
  };
  function traverse(target) {
    assert.ok(target >= 0 && target < entries.length, "Nie wolno wyjść poza historię");
    position = target;
    dispatch(navigationListeners, "currententrychange", { navigationType: "traverse" });
    dispatch(listeners, "popstate", { state: entries[position].state });
  }
  if (modern) host.navigation = {
    get currentEntry() { return { key: entries[position].key, index: position }; },
    addEventListener(type, callback) { add(navigationListeners, type, callback); },
    removeEventListener(type, callback) { remove(navigationListeners, type, callback); },
    traverseTo(key) {
      restored.push(key);
      pending.push(() => traverse(entries.findIndex((entry) => entry.key === key)));
      return { finished: Promise.resolve() };
    },
  };
  // Nasłuch Next.js celowo rejestrowany wcześniej, ale w fazie bubble.
  host.addEventListener("popstate", () => applicationPops.push(host.location.href));
  return {
    host, entries, confirmations, restored, applicationPops,
    confirm(value) { answer = value; },
    push(url) { host.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { route: url }, custom: "keep" }, "", url); },
    back(steps = 1) { traverse(position - steps); },
    forward(steps = 1) { traverse(position + steps); },
    flush() {
      let count = 0;
      while (pending.length) {
        assert.ok(count++ < 20, "Pętla przywracania historii");
        pending.shift()();
      }
    },
    beforeUnload() {
      let prevented = false;
      const event = { preventDefault() { prevented = true; }, returnValue: undefined };
      dispatch(listeners, "beforeunload", event);
      return { prevented, value: event.returnValue };
    },
    get position() { return position; },
    count(type) { return listeners.get(type)?.size ?? 0; },
    get navigationListenerCount() { return Array.from(navigationListeners.values()).reduce((n, set) => n + set.size, 0); },
  };
}

for (const modern of [true, false]) {
  const name = modern ? "Navigation API" : "History API";
  test(`${name}: anulowanie Wstecz zachowuje widok, szkic, stan Next.js i wszystkie wpisy Dalej`, () => {
    const b = browser(modern);
    const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host);
    const cleanup = api.installNavigationGuard(b.host);
    b.push("/follow-ups");
    b.push("/calendar");
    const state = b.entries.map((entry) => ({ ...entry }));
    const unregister = api.registerUnsavedChanges({ dirty: true, blocked: false });
    for (let i = 0; i < 3; i++) {
      b.back(i === 2 ? 2 : 1);
      b.flush();
      assert.equal(b.position, 2);
      assert.equal(b.host.location.href, "https://crm.test/calendar");
      assert.equal(b.host.history.length, 3);
      assert.deepEqual(b.entries, state);
    }
    assert.equal(b.applicationPops.length, 0, "Next.js nie może odmontować formularza");
    assert.equal(b.confirmations.length, 3, "Przywracanie nie może pytać drugi raz");
    b.confirm(true);
    b.back();
    assert.equal(b.position, 1);
    assert.equal(b.applicationPops.length, 1);
    unregister();
    b.forward();
    assert.equal(b.position, 2);
    assert.equal(b.confirmations.length, 4);
    cleanup();
  });

  test(`${name}: anulowanie Dalej przywraca dokładnie poprzednią pozycję; akceptacja nie dodaje wpisu`, () => {
    const b = browser(modern);
    const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host);
    const cleanup = api.installNavigationGuard(b.host);
    b.push("/follow-ups");
    b.push("/calendar");
    b.back(2);
    assert.equal(b.position, 0);
    const unregister = api.registerUnsavedChanges({ dirty: true, blocked: false });
    b.forward(2);
    b.flush();
    assert.equal(b.position, 0);
    assert.equal(b.host.history.length, 3);
    assert.equal(b.confirmations.length, 1);
    b.confirm(true);
    b.forward();
    assert.equal(b.position, 1);
    assert.equal(b.host.history.length, 3);
    assert.equal(b.confirmations.length, 2);
    unregister();
    cleanup();
  });

  test(`${name}: bez zmian nie ostrzega; pending blokuje nawigację bez podwójnego potwierdzenia`, () => {
    const b = browser(modern);
    const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host);
    const cleanup = api.installNavigationGuard(b.host);
    b.push("/calendar");
    b.back();
    assert.equal(b.position, 0);
    assert.equal(b.confirmations.length, 0);
    const unregister = api.registerUnsavedChanges({ dirty: true, blocked: true });
    b.forward();
    b.flush();
    assert.equal(b.position, 0);
    assert.equal(b.confirmations.length, 0);
    unregister();
    cleanup();
  });

  test(`${name}: sprzątanie usuwa listenery i przywraca nadpisane metody historii`, () => {
    const b = browser(modern);
    const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host);
    const push = b.host.history.pushState, replace = b.host.history.replaceState;
    for (let i = 0; i < 3; i++) {
      const cleanup = api.installNavigationGuard(b.host);
      assert.equal(b.count("popstate"), 2);
      cleanup();
      assert.equal(b.count("popstate"), 1);
      assert.equal(b.count("pageshow"), 0);
      assert.equal(b.navigationListenerCount, 0);
      assert.equal(b.host.history.pushState, push);
      assert.equal(b.host.history.replaceState, replace);
    }
  });
}

test("jeden beforeunload dla obu formularzy; po zapisaniu/odmontowaniu nie pozostają ostrzeżenia", () => {
  const b = browser(true);
  const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host);
  const first = api.registerUnsavedChanges({ dirty: true, blocked: false });
  const second = api.registerUnsavedChanges({ dirty: true, blocked: false });
  assert.equal(b.count("beforeunload"), 1);
  assert.equal(b.beforeUnload().prevented, true);
  first();
  assert.equal(b.beforeUnload().prevented, true);
  second();
  assert.equal(b.count("beforeunload"), 0);
  assert.equal(b.beforeUnload().prevented, false);
  assert.equal(api.confirmNavigation(), true);
  assert.equal(b.confirmations.length, 0);
});

test("zakładki Next.js blokują przejście po odmowie i pozwalają odejść po odrzuceniu zmian", () => {
  const b = browser(true), cache = new Map();
  const mocks = { "next/navigation": { usePathname: () => "/pipeline" }, "next/link": { default: function Link() {} } };
  const api = loadModule("src/lib/navigation/unsaved-changes.ts", b.host, mocks, cache);
  const { AppNavigation } = loadModule("src/components/app-navigation.tsx", b.host, mocks, cache);
  const unregister = api.registerUnsavedChanges({ dirty: true, blocked: false });
  const links = AppNavigation().props.children;
  let prevented = false;
  links.find((link) => link.props.href === "/follow-ups").props.onNavigate({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(b.confirmations.length, 1);
  b.confirm(true);
  prevented = false;
  links.find((link) => link.props.href === "/calendar").props.onNavigate({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(b.confirmations.length, 2);
  links.find((link) => link.props.href === "/pipeline").props.onNavigate({ preventDefault() { assert.fail("Bieżąca zakładka nie opuszcza formularza"); } });
  assert.equal(b.confirmations.length, 2);
  unregister();
});
