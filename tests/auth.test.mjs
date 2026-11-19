import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
const root = path.resolve(import.meta.dirname, "..");
// Wyłącznie lokalne fixture'y testów. Żadne konto ani dane nie powstają w Supabase.
const testEnv = { url: "https://auth-test.supabase.co", publishableKey: "sb_publishable_test" };
const testPassword = randomBytes(24).toString("base64url");

function loadModule(relativePath, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: moduleObject, exports: moduleObject.exports, console, URL,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "@/lib/supabase/env") return { getSupabaseEnv: () => testEnv };
      if (name.startsWith("@/")) return loadModule("src/" + name.slice(2) + ".ts", mocks, cache);
      return require(name);
    },
  }, { filename });
  return moduleObject.exports;
}

function proxyWithClaims(result, onVerify) {
  return loadModule("src/lib/supabase/proxy.ts", {
    "@supabase/ssr": {
      createServerClient: (_url, _key, options) => ({
        auth: { getClaims: async () => { await onVerify?.(options.cookies); return result; } },
      }),
    },
  });
}

test("adres powrotu dopuszcza wyłącznie trzy widoki CRM", () => {
  const { getSafeRedirect } = loadModule("src/lib/auth/redirect.ts");
  for (const route of ["/pipeline", "/follow-ups", "/calendar"]) assert.equal(getSafeRedirect(route), route);
  for (const input of [null, ["/calendar"], "https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/login", "/calendar?next=//example.com", "/%2fexample.com"]) {
    assert.equal(getSafeRedirect(input), "/pipeline");
  }
});

test("gość trafia do logowania z bezpiecznym adresem powrotu; /login nie tworzy pętli", async () => {
  const { updateSession } = proxyWithClaims({ data: null, error: null });
  for (const route of ["/", "/pipeline", "/follow-ups", "/calendar", "/pipeline/nested"]) {
    const response = await updateSession(new NextRequest("https://crm.test" + route));
    const target = new URL(response.headers.get("location"));
    assert.equal(response.status, 307);
    assert.equal(target.pathname, "/login");
    assert.equal(target.searchParams.get("next"), ["/follow-ups", "/calendar"].includes(route) ? route : "/pipeline");
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
  }
  const login = await updateSession(new NextRequest("https://crm.test/login?next=/calendar"));
  assert.equal(login.headers.get("location"), null);
  const post = await updateSession(new NextRequest("https://crm.test/pipeline", { method: "POST" }));
  assert.equal(post.status, 303);
});

test("błąd weryfikacji i awaria Auth zamykają dostęp", async () => {
  const denied = proxyWithClaims({ data: { claims: { sub: "untrusted" } }, error: new Error("invalid") });
  assert.equal((await denied.updateSession(new NextRequest("https://crm.test/calendar"))).status, 307);
  const unavailable = proxyWithClaims(null, () => { throw new Error("offline"); });
  assert.equal((await unavailable.updateSession(new NextRequest("https://crm.test/pipeline"))).status, 307);
});

test("anonimowa sesja Supabase nie daje dostępu do prywatnego CRM", async () => {
  const { updateSession } = proxyWithClaims({ data: { claims: { sub: "anonymous", is_anonymous: true } }, error: null });
  assert.equal((await updateSession(new NextRequest("https://crm.test/pipeline"))).status, 307);
  assert.equal((await updateSession(new NextRequest("https://crm.test/login"))).headers.get("location"), null);
});

test("zweryfikowany użytkownik omija formularz i ma dostęp do CRM", async () => {
  const { updateSession } = proxyWithClaims({ data: { claims: { sub: "test-subject" } }, error: null });
  for (const route of ["/pipeline", "/follow-ups", "/calendar"]) {
    assert.equal((await updateSession(new NextRequest("https://crm.test" + route))).headers.get("location"), null);
  }
  for (const [query, expected] of [["/calendar", "/calendar"], ["//example.com", "/pipeline"], ["/login", "/pipeline"]]) {
    const request = new NextRequest("https://crm.test/login?next=" + encodeURIComponent(query));
    const response = await updateSession(request);
    assert.equal(new URL(response.headers.get("location")).pathname, expected);
    assert.equal(new URL(response.headers.get("location")).origin, "https://crm.test");
  }
});

test("odświeżone cookies i nagłówki cache przetrwają kolejne zapisy oraz przekierowanie", async () => {
  const request = new NextRequest("https://crm.test/login");
  const { updateSession } = proxyWithClaims(
    { data: { claims: { sub: "test-subject" } }, error: null },
    (cookies) => {
      cookies.setAll([{ name: "session-part-0", value: "new-0", options: { path: "/", sameSite: "lax", secure: true } }], { "Cache-Control": "private, no-store", Expires: "0", Pragma: "no-cache" });
      cookies.setAll([{ name: "session-part-1", value: "new-1", options: { path: "/", maxAge: 3600 } }], { "Cache-Control": "private, no-store" });
    },
  );
  const response = await updateSession(request);
  assert.equal(response.status, 307);
  assert.equal(request.cookies.get("session-part-0").value, "new-0");
  assert.equal(response.cookies.get("session-part-0").value, "new-0");
  assert.equal(response.cookies.get("session-part-0").secure, true);
  assert.equal(response.cookies.get("session-part-1").value, "new-1");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("dodatkowa weryfikacja serwerowa odrzuca cookies bez potwierdzonych claims", async () => {
  for (const result of [{ data: null, error: null }, { data: { claims: { sub: "untrusted" } }, error: new Error("invalid") }, { data: { claims: { sub: "anonymous", is_anonymous: true } }, error: null }]) {
    const { getAuthenticatedClaims } = loadModule("src/lib/auth/session.ts", {
      "@/lib/supabase/server": { createClient: async () => ({ auth: { getClaims: async () => result } }) },
    });
    assert.equal(await getAuthenticatedClaims(), null);
  }
});

function actionHarness(auth) {
  const invalidations = [];
  const actions = loadModule("src/app/actions/auth.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth }) },
    "next/cache": { revalidatePath: (...args) => invalidations.push(args) },
    "next/navigation": { redirect: (destination) => { const error = new Error("redirect"); error.destination = destination; throw error; } },
  });
  return { ...actions, invalidations };
}

function loginData() {
  const data = new FormData();
  data.set("email", "owner@example.test");
  data.set("password", testPassword);
  data.set("next", "/calendar");
  return data;
}

test("walidacja i błędne hasło nie zwracają hasła ani szczegółów błędu usługi", async () => {
  const invalid = actionHarness({ signInWithPassword: () => assert.fail("Nie należy wysyłać niepoprawnego formularza") });
  const state = await invalid.login({}, new FormData());
  assert.ok(state.fieldErrors.email);
  assert.ok(state.fieldErrors.password);
  const failed = actionHarness({ signInWithPassword: async () => ({ data: { session: null }, error: { code: "invalid_credentials", message: "internal-secret" } }) });
  const result = await failed.login({}, loginData());
  assert.equal(result.message, "Nieprawidłowy adres e-mail lub hasło.");
  assert.equal(JSON.stringify(result).includes(testPassword), false);
  assert.equal(JSON.stringify(result).includes("internal-secret"), false);
  assert.equal(failed.invalidations.length, 0);
});

test("logowanie przekazuje dane do Auth, unieważnia cache i wraca tylko do dozwolonej trasy", async () => {
  const successful = actionHarness({ signInWithPassword: async ({ email, password }) => {
    assert.equal(email, "owner@example.test");
    assert.equal(password, testPassword);
    return { data: { session: {} }, error: null };
  } });
  await assert.rejects(successful.login({}, loginData()), (error) => error.destination === "/calendar");
  const unsafe = loginData();
  unsafe.set("next", "//example.com");
  await assert.rejects(successful.login({}, unsafe), (error) => error.destination === "/pipeline");
  assert.deepEqual(successful.invalidations, [["/", "layout"], ["/", "layout"]]);
});

test("awaria logowania i limit prób mają czytelne komunikaty", async () => {
  const offline = actionHarness({ signInWithPassword: async () => { throw new Error("network"); } });
  assert.match((await offline.login({}, loginData())).message, /połączyć/);
  const limited = actionHarness({ signInWithPassword: async () => ({ data: { session: null }, error: { status: 429 } }) });
  assert.match((await limited.login({}, loginData())).message, /Zbyt wiele prób/);
});

test("wylogowanie kończy bieżącą sesję i czyści cache; przy błędzie nie udaje sukcesu", async () => {
  const success = actionHarness({ signOut: async (options) => { assert.equal(options.scope, "local"); return { error: null }; } });
  await assert.rejects(success.logout(), (error) => error.destination === "/login");
  assert.deepEqual(success.invalidations, [["/", "layout"]]);
  const failure = actionHarness({ signOut: async () => ({ error: new Error("network") }) });
  assert.match((await failure.logout()).message, /Nie udało się wylogować/);
  assert.equal(failure.invalidations.length, 0);
});

test("rzeczywisty SDK odrzuca sfałszowany podpis JWT w cookie", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "ES256", kid: "local-auth-test", use: "sig" };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const header = encode({ alg: "ES256", kid: jwk.kid, typ: "JWT" });
  const payload = encode({ sub: "local-test-subject", aud: "authenticated", role: "authenticated", exp });
  const signature = sign("sha256", Buffer.from(header + "." + payload), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, "/auth/v1/.well-known/jwks.json");
    return Response.json({ keys: [jwk] });
  };
  try {
    const { updateSession } = loadModule("src/lib/supabase/proxy.ts");
    for (const [body, expectedStatus] of [[payload, 200], [encode({ sub: "forged-subject", aud: "authenticated", role: "authenticated", exp }), 307]]) {
      const token = header + "." + body + "." + signature;
      const cookie = "base64-" + encode({ access_token: token, refresh_token: "local-test-refresh", expires_at: exp, expires_in: 3600, token_type: "bearer", user: { id: "local-test-subject" } });
      const request = new NextRequest("https://crm.test/pipeline", { headers: { cookie: "sb-auth-test-auth-token=" + cookie } });
      const response = await updateSession(request);
      assert.equal(response.status, expectedStatus);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
