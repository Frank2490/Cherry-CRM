import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
function loadModule(relative, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module: moduleObject,
    exports: moduleObject.exports,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/"))
        return loadModule("src/" + name.slice(2) + ".ts", mocks, cache);
      return require(name);
    },
  }, { filename });
  return moduleObject.exports;
}

const { LEAD_CONFLICT_MESSAGE, isLeadVersion } = loadModule("src/lib/leads/version.ts");
const { leadEditValues } = loadModule("src/lib/leads/details.ts");
const owner = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const leadId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const version = "2026-11-19T12:00:00.123456+00:00";

// Lokalny model warunkowego UPDATE, bez żądań sieciowych i danych produkcyjnych.
// Filtry są oceniane w momencie zapisu; beforeUpdate symuluje zmianę po SELECT.
function databaseHarness() {
  let tick = 123456;
  let viewer = owner;
  const stored = {
    id: leadId, user_id: owner, updated_at: version,
    company_name: "Klient", instagram: "@kontakt", email: null, phone: null,
    status: "new", service_type: null, estimated_value: null,
    follow_up_date: "2026-11-21", next_step: null, notes: "Oryginał",
    created_at: "2026-01-01T00:00:00+00:00", last_contact_at: null,
  };
  const writes = [];
  const refreshes = [];
  let beforeUpdate;
  function externalChange(changes) {
    Object.assign(stored, changes, {
      updated_at: `2026-11-19T12:00:00.${++tick}+00:00`,
    });
  }
  function query() {
    const predicates = [];
    const filters = [];
    let payload;
    const builder = {
      schema() { return builder; },
      from(table) { assert.equal(table, "leads"); return builder; },
      select() { return builder; },
      maybeSingle() { return builder; },
      eq(field, value) {
        filters.push([field, value]);
        predicates.push(() => stored[field] === value);
        return builder;
      },
      is(field, value) { return builder.eq(field, value); },
      in(field, values) {
        predicates.push(() => values.includes(stored[field]));
        return builder;
      },
      update(values) { payload = values; return builder; },
      async overrideTypes() {
        if (payload) {
          beforeUpdate?.();
          writes.push({ filters, payload });
        }
        if (!predicates.every((matches) => matches()))
          return { data: null, error: null };
        if (payload) externalChange(payload);
        return { data: { ...stored }, error: null };
      },
    };
    return builder;
  }
  const mocks = {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => ({ sub: viewer }) },
    "@/lib/supabase/server": { createClient: async () => query() },
    "next/cache": { revalidatePath(route) { refreshes.push(route); } },
  };
  return {
    ...loadModule("src/app/actions/leads.ts", mocks),
    ...loadModule("src/app/actions/follow-ups.ts", mocks),
    stored, writes, refreshes, externalChange,
    beforeUpdate(callback) { beforeUpdate = callback; },
    viewer(value) { viewer = value; },
  };
}

function save(api, operation, snapshot, changes = {}) {
  if (operation === "status")
    return api.moveLeadStatus(leadId, {
      status: "interested", expectedStatus: snapshot.status,
      expectedFollowUpDate: snapshot.follow_up_date,
      expectedUpdatedAt: snapshot.updated_at, clearFollowUpConfirmed: true,
      ...changes,
    });
  const data = new FormData();
  const values = operation === "panel"
    ? { ...leadEditValues(snapshot), notes: "Pierwszy zapis" }
    : { mode: operation, follow_up_date: "2026-12-01" };
  for (const [key, value] of Object.entries({
    ...values, expected_updated_at: snapshot.updated_at, ...changes,
  })) data.set(key, value);
  return operation === "panel"
    ? api.updateLead(leadId, data)
    : api.saveFollowUp(leadId, data);
}

test("wersja akceptuje TIMESTAMPTZ z mikrosekundami i odrzuca niepoprawne wartości", () => {
  for (const value of [version, "2026-11-19T12:00:00Z", "2026-11-19T13:00:00.000001+01:00"])
    assert.equal(isLeadVersion(value), true);
  for (const value of [null, undefined, {}, "", "now()", "infinity", "2026-11-19", "2026-02-29T00:00:00Z", "2026-11-19T24:00:00Z", "2026-11-19T12:00:00.1234567Z"])
    assert.equal(isLeadVersion(value), false);
});

for (const first of ["panel", "status", "complete", "reschedule"])
  for (const second of ["panel", "status", "complete", "reschedule"])
    test(`${first} → ${second}: pierwszy zapis zmienia wersję, drugi zachowuje nowsze dane i zwraca konflikt`, async () => {
      const api = databaseHarness();
      const a = (await api.getLeadDetails(leadId)).lead;
      const b = (await api.getLeadDetails(leadId)).lead;
      assert.equal(a.updated_at, b.updated_at);
      const firstResult = await save(api, first, a);
      assert.equal(firstResult.ok, true);
      assert.notEqual(api.stored.updated_at, version);
      if (firstResult.lead) assert.equal(firstResult.lead.updated_at, api.stored.updated_at);
      // Obie wersje mieszczą się w tej samej milisekundzie JS.
      assert.equal(Date.parse(api.stored.updated_at), Date.parse(version));
      const afterFirst = { ...api.stored };
      const refreshed = api.refreshes.length;
      const secondResult = await save(api, second, b);
      assert.equal(secondResult.ok, false);
      assert.equal(secondResult.conflict, true);
      assert.equal(secondResult.message, LEAD_CONFLICT_MESSAGE);
      assert.deepEqual(api.stored, afterFirst);
      assert.equal(api.refreshes.length, refreshed);
      for (const { filters, payload } of api.writes) {
        assert.ok(filters.some(([field, value]) => field === "updated_at" && value === version));
        assert.equal("updated_at" in payload, false);
        assert.equal("user_id" in payload, false);
      }
    });

test("drag & drop odrzuca także zmianę notatek wykonaną między SELECT a UPDATE", async () => {
  const api = databaseHarness();
  const snapshot = { ...api.stored };
  api.beforeUpdate(() => api.externalChange({ notes: "Nowsza notatka" }));
  const result = await save(api, "status", snapshot);
  assert.equal(result.conflict, true);
  assert.equal(result.message, LEAD_CONFLICT_MESSAGE);
  assert.equal(api.stored.notes, "Nowsza notatka");
  assert.equal(api.stored.status, "new");
  assert.equal(api.stored.follow_up_date, snapshot.follow_up_date);
  assert.equal(api.refreshes.length, 0);
  assert.ok(api.writes[0].filters.some(([field, value]) => field === "updated_at" && value === version));
});

test("brak lub wadliwa wersja blokuje wszystkie operacje przed UPDATE", async () => {
  for (const operation of ["panel", "status", "complete", "reschedule"])
    for (const value of ["", "invalid", "2026-11-19"] ) {
      const api = databaseHarness();
      const result = await save(api, operation, { ...api.stored, updated_at: value });
      assert.equal(result.ok, false);
      assert.equal(api.writes.length, 0);
      assert.equal(api.stored.updated_at, version);
    }
});

test("zgodna wersja nie pozwala edytować cudzego leada", async () => {
  for (const operation of ["panel", "status", "complete", "reschedule"]) {
    const api = databaseHarness();
    const snapshot = { ...api.stored };
    api.viewer("cccccccc-cccc-4ccc-cccc-cccccccccccc");
    const result = await save(api, operation, snapshot);
    assert.equal(result.ok, false);
    assert.deepEqual(api.stored, snapshot);
  }
});

test("po odświeżeniu można zapisać z nową wersją; Przełóż nie zmienia ostatniego kontaktu", async () => {
  const api = databaseHarness();
  const stale = { ...api.stored };
  assert.equal((await save(api, "complete", stale)).ok, true);
  const lastContact = api.stored.last_contact_at;
  assert.ok(lastContact);
  assert.equal((await save(api, "reschedule", stale)).conflict, true);
  const fresh = (await api.getLeadDetails(leadId)).lead;
  assert.equal((await save(api, "reschedule", fresh, { follow_up_date: "" })).ok, true);
  assert.equal(api.stored.follow_up_date, null);
  assert.equal(api.stored.last_contact_at, lastContact);
});
