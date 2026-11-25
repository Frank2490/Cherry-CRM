import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const token = "synthetic_import_token_for_local_tests";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOwner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const env = {
  CHERRY_LEAD_IMPORT_TOKEN: token,
  CHERRY_LEAD_IMPORT_OWNER_ID: owner,
  CHERRY_LEAD_IMPORT_OWNER_EMAIL: "owner@example.invalid",
  CHERRY_LEAD_IMPORT_OWNER_PASSWORD: "synthetic-password",
  NEXT_PUBLIC_SUPABASE_URL: "https://crm-test.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
};
const input = {
  company_name: "  Firma   testowa  ",
  instagram: " https://www.instagram.com/Cherry.Design/?igsh=synthetic ",
  status: "new",
  notes: "Analiza: lokalna\nŹródło: formularz\n\nDM: Dzień dobry!  ",
  next_step: " Napisać wiadomość ",
};

const compiled = new Map();
function loadRoute(settings, fetch) {
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const moduleObject = { exports: {} };
    modules.set(relative, moduleObject);
    if (!compiled.has(relative)) {
      const filename = new URL(`../${relative}`, import.meta.url);
      compiled.set(relative, ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
      }).outputText);
    }
    vm.runInNewContext(compiled.get(relative), {
      module: moduleObject, exports: moduleObject.exports, Response, Headers, TextDecoder, URL,
      process: { env: settings },
      require(name) {
        if (name === "@supabase/supabase-js") {
          return { createClient: (url, key, options) => createClient(url, key, { ...options, global: { fetch } }) };
        }
        if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
        return require(name);
      },
    }, { filename: relative });
    return moduleObject.exports;
  }
  return load("src/app/api/leads/import/route.ts").POST;
}

function request(body = input, headers = {}, authorization = `Bearer ${token}`) {
  return new Request(`https://crm-test.invalid/api/leads/import?user_id=${otherOwner}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization === null ? {} : { Authorization: authorization }),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function harness({ rows = [], parallel = false, authOwner = owner, anonymous = false, authError, rpcError, settings = {} } = {}) {
  const calls = [];
  let lostResponse = false;
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const jwtParts = [{ alg: "HS256", typ: "JWT" }, { sub: authOwner, role: "authenticated", is_anonymous: anonymous }];
  const jwt = jwtParts.map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c2ln";

  const POST = loadRoute({ ...env, ...settings }, async (target, options) => {
    const url = new URL(target);
    const headers = new Headers(options.headers);
    const body = JSON.parse(options.body);
    calls.push({ path: url.pathname, body });
    assert.equal(url.origin, env.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(options.method, "POST");
    assert.equal(headers.get("apikey"), env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "password");
      assert.equal(body.email, env.CHERRY_LEAD_IMPORT_OWNER_EMAIL);
      assert.equal(body.password, env.CHERRY_LEAD_IMPORT_OWNER_PASSWORD);
      if (authError) return Response.json({ message: authError }, { status: 429 });
      return Response.json({
        access_token: jwt, refresh_token: "synthetic-refresh-token", expires_in: 3600,
        token_type: "bearer", user: { id: authOwner, is_anonymous: anonymous },
      });
    }

    assert.equal(url.pathname, "/rest/v1/rpc/import_instagram_lead");
    assert.equal(headers.get("authorization"), `Bearer ${jwt}`);
    assert.deepEqual(Object.keys(body).sort(), ["p_company_name", "p_instagram", "p_next_step", "p_notes"]);
    if (parallel) {
      if (++arrivals === 2) release();
      await barrier;
    }
    if (rpcError) return Response.json({ message: rpcError, code: "42501" }, { status: 403 });
    const result = rows.some((row) => row.user_id === authOwner && row.normalized === body.p_instagram)
      ? "already_exists" : "created";
    if (result === "created") {
      rows.push({
        user_id: authOwner, status: "new", instagram: `@${body.p_instagram}`, normalized: body.p_instagram,
        company_name: body.p_company_name, notes: body.p_notes, next_step: body.p_next_step,
      });
    }
    if (lostResponse) {
      lostResponse = false;
      return Response.json({ message: "upstream failure after commit" }, { status: 500 });
    }
    return Response.json(result);
  });
  return { POST, calls, rows, loseResponse: () => { lostResponse = true; } };
}

async function check(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), body);
}

test("import używa skonfigurowanego właściciela, zachowuje Notatki i ustawia status new", async () => {
  const db = harness();
  await check(await db.POST(request(input, { Cookie: "sb-session=untrusted", "Content-Type": "Application/JSON; charset=UTF-8" })), 201, { result: "created" });
  assert.deepEqual(db.rows, [{
    user_id: owner, status: "new", instagram: "@cherry.design", normalized: "cherry.design",
    company_name: "Firma testowa", notes: input.notes, next_step: "Napisać wiadomość",
  }]);
});

test("błędny, brakujący i niejednoznaczny Bearer są odrzucane przed Auth", async () => {
  const db = harness();
  for (const authorization of [null, "Bearer too-short", "x", `Basic ${token}`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token.slice(0, -1)}x`]) {
    const response = await db.POST(request("bad json", {}, authorization));
    assert.equal(response.headers.get("WWW-Authenticate"), "Bearer");
    await check(response, 401, { result: "error", code: "unauthorized" });
  }
  assert.equal(db.calls.length, 0);
});

test("niepoprawne typy, pola spoza kontraktu, rozmiary i profile są odrzucane przed Auth", async () => {
  const db = harness();
  const badInputs = [null, [], {},
    ...[
      { company_name: "\u00a0\t" }, { company_name: "a".repeat(201) }, { company_name: "Nazwa\0" },
      { instagram: "a".repeat(31) }, { instagram: "insta gram" }, { instagram: "@@cherry" },
      { instagram: "name..here" }, { instagram: ".name" }, { instagram: "name." },
      { instagram: "https://instagram.com.fake/cherry" }, { instagram: "https://instagram.com/p/shortcode" },
      { instagram: "https://evil.test/instagram.com/cherry" },
      { instagram: `https://instagram.com/cherry?${"x".repeat(500)}` },
      { status: "won" }, { status: undefined }, { notes: undefined }, { notes: null }, { notes: [] },
      { notes: "a".repeat(12_001) }, { notes: "\ud800" }, { next_step: 100 }, { next_step: "a".repeat(1001) },
      { user_id: otherOwner }, { owner_id: otherOwner }, { follow_up_date: "2026-12-01" }, { score: 60 },
    ].map((overrides) => ({ ...input, ...overrides })),
  ];
  for (const body of badInputs)
    await check(await db.POST(request(body)), 422, { result: "error", code: "invalid_payload" });
  await check(await db.POST(request('{"__proto__":{}}')), 422, { result: "error", code: "invalid_payload" });
  await check(await db.POST(request("{")), 400, { result: "error", code: "invalid_json" });
  await check(await db.POST(request(input, { "Content-Type": "text/plain" })), 415, { result: "error", code: "unsupported_media_type" });
  assert.equal(db.calls.length, 0);
});

test("limit bajtów działa bez nagłówka i przy zaniżonym Content-Length", async () => {
  const db = harness();
  await check(await db.POST(request(input, { "Content-Length": "65537" })), 413, { result: "error", code: "payload_too_large" });
  await check(await db.POST(request(`"${"ą".repeat(33_000)}"`)), 413, { result: "error", code: "payload_too_large" });
  const chunks = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40_000).fill(32));
      controller.enqueue(new Uint8Array(30_000).fill(32));
      controller.close();
    },
  });
  const streamed = new Request("https://crm-test.invalid", {
    method: "POST", duplex: "half", body: chunks,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": "3" },
  });
  await check(await db.POST(streamed), 413, { result: "error", code: "payload_too_large" });
  assert.equal(db.calls.length, 0);
});

test("ponowienie po normalizacji zachowuje dane wcześniej istniejącego leada", async () => {
  const existing = { user_id: owner, status: "won", instagram: "  @CHERRY.Design ", normalized: "cherry.design", notes: "Stara notatka", next_step: "Stary krok" };
  const db = harness({ rows: [structuredClone(existing)] });
  await check(await db.POST(request()), 200, { result: "already_exists" });
  await check(await db.POST(request({ ...input, instagram: "cherry.design", notes: "Inna notatka" })), 200, { result: "already_exists" });
  assert.deepEqual(db.rows, [existing]);
});

test("równoległy import zwraca jeden zapis i jeden duplikat", { timeout: 3000 }, async () => {
  const db = harness({ parallel: true });
  const responses = await Promise.all([
    db.POST(request({ ...input, instagram: "@Cherry.Design" })),
    db.POST(request({ ...input, instagram: "m.instagram.com/CHERRY.DESIGN/" })),
  ]);
  responses.sort((a, b) => a.status - b.status);
  await check(responses[0], 200, { result: "already_exists" });
  await check(responses[1], 201, { result: "created" });
  assert.equal(db.rows.length, 1);
});

test("ten sam Instagram u innego właściciela pozwala na niezależny import bez ujawnienia rekordu", async () => {
  const existing = { user_id: otherOwner, normalized: "cherry.design", private: "cudze dane" };
  const db = harness({ rows: [structuredClone(existing)] });
  await check(await db.POST(request({ ...input, next_step: undefined })), 201, { result: "created" });
  assert.deepEqual(db.rows[0], existing);
  assert.equal(db.rows[1].user_id, owner);
  assert.equal(db.rows[1].next_step, null);
});

test("brak konfiguracji, niezgodna tożsamość i anonimowa sesja nie wywołują RPC", async () => {
  for (const options of [
    { authOwner: otherOwner }, { anonymous: true }, { authError: `private upstream error ${token}` },
    { settings: { CHERRY_LEAD_IMPORT_TOKEN: "" } },
    { settings: { CHERRY_LEAD_IMPORT_OWNER_ID: "invalid" } },
  ]) {
    const db = harness(options);
    await check(await db.POST(request()), 503, { result: "error", code: "import_unavailable" });
    assert.equal(db.calls.some(({ path }) => path.includes("/rpc/")), false);
    assert.deepEqual(db.rows, []);
  }
});

test("błąd bazy jest ogólny, a ponowienie po utracie odpowiedzi nie tworzy duplikatu", async () => {
  const denied = harness({ rpcError: `private RLS details ${owner} ${token}` });
  const db = harness();
  db.loseResponse();
  for (const attempt of [denied, db])
    await check(await attempt.POST(request()), 503, { result: "error", code: "import_unavailable" });
  await check(await db.POST(request()), 200, { result: "already_exists" });
  assert.equal(db.rows.length, 1);
});
