import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadModule(relative, mocks, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: moduleObject, exports: moduleObject.exports,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/"))
        return loadModule("src/" + name.slice(2) + ".ts", mocks, cache);
      return require(name);
    },
  }, { filename });
  return moduleObject.exports;
}

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function form(requestId = operationId, overrides = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    creation_request_id: requestId,
    company_name: "Klient", contact_type: "instagram", contact_value: "@kontakt",
    status: "new", follow_up_date: "", ...overrides,
  })) data.set(key, value);
  return data;
}

// Prawdziwy klient Supabase, ale CAŁY transport HTTP jest lokalną atrapą.
// Model UNIQUE nie zastępuje uruchomienia migracji/testów w PostgreSQL.
function harness({ parallel = false, cacheError = false } = {}) {
  const rows = [];
  const calls = [];
  let arrivals = 0, release;
  let loseResponse = false, readError = false, readMissing = false, insertError;
  const barrier = new Promise((resolve) => { release = resolve; });
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient("https://idempotency-test.invalid", "sb_publishable_local_test", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      async fetch(input, init) {
        const url = new URL(input);
        assert.equal(url.origin, "https://idempotency-test.invalid");
        assert.equal(url.pathname, "/rest/v1/leads");
        const method = init.method;
        calls.push({ method, url });
        if (method === "POST") {
          const payload = JSON.parse(init.body);
          if (parallel) {
            if (++arrivals === 2) release();
            await barrier;
          }
          if (insertError) return json(insertError, 400);
          const existing = rows.find((row) =>
            row.user_id === payload.user_id && row.creation_request_id === payload.creation_request_id,
          );
          if (existing)
            return json({ code: "23505", message: "duplicate creation request" }, 409);
          const row = {
            id: randomUUID(), ...payload, notes: null,
            created_at: "2026-11-19T12:00:00.123456+00:00",
            updated_at: "2026-11-19T12:00:00.123456+00:00",
          };
          rows.push(row);
          if (loseResponse) {
            loseResponse = false;
            throw Error("Odpowiedź utracona po zatwierdzeniu INSERT");
          }
          return json({ id: row.id }, 201);
        }
        assert.equal(method, "GET", "Ponowienie nie może aktualizować ani usuwać danych");
        assert.equal(url.searchParams.get("select"), "id");
        assert.match(url.searchParams.get("user_id"), /^eq\./);
        assert.equal(url.searchParams.get("creation_request_id"), `eq.${operationId}`);
        if (readError) return json({ code: "42501", message: "internal RLS detail" }, 403);
        const matching = readMissing ? [] : rows.filter((row) =>
          url.searchParams.get("user_id") === `eq.${row.user_id}` &&
          url.searchParams.get("creation_request_id") === `eq.${row.creation_request_id}`,
        );
        return json(matching.map((row) => ({ id: row.id })));
      },
    },
  });
  function action(owner = ownerA) {
    return loadModule("src/app/actions/leads.ts", {
      "@/lib/auth/session": { getAuthenticatedClaims: async () => owner ? ({ sub: owner }) : null },
      "@/lib/supabase/server": { createClient: async () => supabase },
      "next/cache": { revalidatePath() { if (cacheError) throw Error("cache"); } },
    }).createLead;
  }
  return {
    rows, calls, action,
    loseNextResponse() { loseResponse = true; },
    readError(value) { readError = value; },
    readMissing(value) { readMissing = value; },
    insertError(value) { insertError = value; },
  };
}

test("utworzenie i ponowienie zwracają to samo ID bez drugiego rekordu", async () => {
  const db = harness();
  const create = db.action();
  const first = await create(form());
  const repeated = await create(form());
  assert.equal(first.ok, true);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.lead.id, first.lead.id);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].creation_request_id, operationId);
  assert.equal(db.rows[0].user_id, ownerA);
  assert.equal(db.calls.filter((call) => call.method === "GET").length, 1);
});

test("dwa równoczesne INSERT-y jednej operacji zwracają jeden rekord", async () => {
  const db = harness({ parallel: true });
  const create = db.action();
  const results = await Promise.all([create(form()), create(form())]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(results[0].lead.id, results[1].lead.id);
  assert.equal(db.rows.length, 1);
});

test("utrata odpowiedzi po zatwierdzonym INSERT nie duplikuje leada podczas ponowienia", async () => {
  const db = harness();
  const create = db.action();
  db.loseNextResponse();
  assert.equal((await create(form())).ok, false);
  assert.equal(db.rows.length, 1, "Pierwszy INSERT został już zatwierdzony");
  const snapshot = { ...db.rows[0] };
  const repeated = await create(form());
  assert.equal(repeated.ok, true);
  assert.equal(repeated.lead.id, snapshot.id);
  assert.deepEqual(db.rows, [snapshot]);
});

test("nowy UUID pozwala utworzyć drugiego leada z identyczną nazwą i kontaktem", async () => {
  const db = harness();
  const create = db.action();
  const first = await create(form());
  const second = await create(form(randomUUID()));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.lead.id, second.lead.id);
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[0].company_name, db.rows[1].company_name);
  assert.equal(db.rows[0].instagram, db.rows[1].instagram);
});

test("ponowienie nie zmienia żadnych danych istniejącego leada, również po jego edycji", async () => {
  const db = harness();
  const create = db.action();
  const first = await create(form());
  Object.assign(db.rows[0], {
    company_name: "Zmieniona nazwa", notes: "Nowsza notatka", status: "won",
    updated_at: "2026-11-19T13:00:00.123456+00:00",
  });
  const snapshot = { ...db.rows[0] };
  const repeated = await create(form(operationId, { company_name: "Nie nadpisuj", status: "interested" }));
  assert.equal(repeated.ok, true);
  assert.equal(repeated.lead.id, first.lead.id);
  assert.deepEqual(db.rows, [snapshot]);
});

test("właściciel pochodzi z Auth, a ten sam UUID innego konta nie udostępnia cudzych danych", async () => {
  const db = harness();
  const a = await db.action(ownerA)(form(operationId, { user_id: ownerB }));
  const b = await db.action(ownerB)(form());
  const repeatedB = await db.action(ownerB)(form());
  assert.ok(a.ok && b.ok && repeatedB.ok);
  assert.notEqual(a.lead.id, b.lead.id);
  assert.equal(repeatedB.lead.id, b.lead.id);
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[0].user_id, ownerA);
  assert.equal(db.rows[1].user_id, ownerB);
  const read = db.calls.find((call) => call.method === "GET");
  assert.equal(read.url.searchParams.get("user_id"), `eq.${ownerB}`);
});

test("brak sesji i brak poprawnego UUID blokują żądanie przed INSERT", async () => {
  const db = harness();
  assert.equal((await db.action(null)(form())).ok, false);
  for (const invalid of ["", "bad-uuid", "null"]) {
    const result = await db.action()(form(invalid));
    assert.equal(result.ok, false);
    assert.match(result.message, /identyfikator/);
  }
  const missing = form();
  missing.delete("creation_request_id");
  assert.equal((await db.action()(missing)).ok, false);
  assert.equal(db.calls.length, 0);
});

test("brak migracji zwraca czytelną informację i nie udaje udanego zapisu", async () => {
  for (const code of ["42703", "PGRST204"]) {
    const db = harness();
    db.insertError({ code, message: "missing column creation_request_id" });
    const result = await db.action()(form());
    assert.equal(result.ok, false);
    assert.match(result.message, /8B\.3/);
    assert.equal(db.rows.length, 0);
  }
});

test("odmowa lub brak wyniku przy potwierdzaniu duplikatu nie zgłasza sukcesu; ponowienie jest bezpieczne", async () => {
  for (const fail of ["readError", "readMissing"]) {
    const db = harness();
    const create = db.action();
    const first = await create(form());
    db[fail](true);
    const failed = await create(form());
    assert.equal(failed.ok, false);
    assert.ok(failed.message.includes("potwierdzić"));
    assert.equal(failed.message.includes("internal"), false);
    db[fail](false);
    const retry = await create(form());
    assert.equal(retry.ok, true);
    assert.equal(retry.lead.id, first.lead.id);
    assert.equal(db.rows.length, 1);
  }
});

test("inne naruszenie UNIQUE bez rekordu tej operacji pozostaje błędem", async () => {
  const db = harness();
  db.insertError({ code: "23505", message: "inny indeks" });
  const result = await db.action()(form());
  assert.equal(result.ok, false);
  assert.equal(db.rows.length, 0);
});

test("awaria odświeżania cache nie zmienia potwierdzonego zapisu lub ponowienia w błąd", async () => {
  const db = harness({ cacheError: true });
  const create = db.action();
  const first = await create(form());
  const repeated = await create(form());
  assert.ok(first.ok && repeated.ok);
  assert.equal(repeated.lead.id, first.lead.id);
  assert.equal(db.rows.length, 1);
});
