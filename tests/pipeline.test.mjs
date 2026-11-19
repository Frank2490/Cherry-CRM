import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

function loadModule(relativePath, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const moduleObject = { exports: {} };
  cache.set(filename, moduleObject);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(
    compiled,
    {
      module: moduleObject,
      exports: moduleObject.exports,
      console,
      URL,
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        if (name === "next/navigation")
          return { ...require(name), useRouter: () => ({ refresh() {} }) };
        if (name.startsWith("@/")) {
          const base = "src/" + name.slice(2);
          const file = [base + ".ts", base + ".tsx"].find((candidate) =>
            fs.existsSync(path.join(root, candidate)),
          );
          return loadModule(file, mocks, cache);
        }
        return require(name);
      },
    },
    { filename },
  );
  return moduleObject.exports;
}

const pipeline = loadModule("src/lib/leads/pipeline.ts");
const { LEAD_STATUSES } = loadModule("src/lib/leads/statuses.ts");

// WCAG 2.2, sRGB: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

for (const status of LEAD_STATUSES) {
  test(`kontrast statusu ${status.label} wynosi co najmniej 4,5:1, również po najechaniu`, () => {
    for (const background of ["#ffffff", "#fafafa"]) {
      const ratio = contrast(status.textColor, background);
      assert.ok(ratio >= 4.5, `${status.label} na ${background}: ${ratio}:1`);
      // Pipeline ma neutralne nagłówki na białym tle, niezależne od akcentu.
      assert.ok(contrast("#18181b", background) >= 4.5);
    }
  });
}

// Fixture'y istnieją wyłącznie w pamięci tych testów, poza aplikacją i bazą.
function lead(overrides = {}) {
  return {
    id: "test-id",
    updated_at: "2026-11-19T12:00:00.123456+00:00",
    company_name: "Nazwa z rekordu",
    instagram: null,
    email: null,
    phone: "kontakt",
    status: "new",
    service_type: null,
    estimated_value: null,
    follow_up_date: "2026-11-17",
    ...overrides,
  };
}

test("pusty Pipeline renderuje siedem kolumn z zerami, bez kart i przycisków", () => {
  const { PipelineBoard } = loadModule(
    "src/components/pipeline/pipeline-board.tsx",
  );
  const html = renderToStaticMarkup(
    createElement(PipelineBoard, { leads: [] }),
  );
  assert.equal((html.match(/<h2\b/g) || []).length, 7);
  assert.equal((html.match(/Liczba leadów: 0/g) || []).length, 7);
  assert.equal(
    (html.match(/Nie ma jeszcze klientów na tym etapie\./g) || []).length,
    7,
  );
  assert.equal(html.includes("<article"), false);
  assert.equal(html.includes("<button"), false);
  for (const status of LEAD_STATUSES) {
    assert.ok(html.includes(status.label));
    assert.ok(html.includes("border-top-color:" + status.color));
  }
});

test("grupowanie obejmuje każdy status i sortuje terminy bez modyfikowania wejścia", () => {
  const rows = LEAD_STATUSES.map((status, index) =>
    lead({ id: String(index), status: status.value }),
  );
  rows.push(lead({ id: "earlier", follow_up_date: "2026-11-01" }));
  rows.push(lead({ id: "later", follow_up_date: "2026-12-01" }));
  rows.push(lead({ id: "no-date", follow_up_date: null }));
  const original = JSON.stringify(rows);
  const groups = pipeline.groupPipelineLeads(rows);
  assert.equal(groups.length, 7);
  assert.deepEqual(
    Array.from(groups[0].leads, (row) => row.id),
    ["earlier", "0", "later", "no-date"],
  );
  for (const group of groups)
    assert.ok(group.leads.every((row) => row.status === group.status.value));
  assert.equal(
    groups.reduce((sum, group) => sum + group.leads.length, 0),
    rows.length,
  );
  assert.equal(JSON.stringify(rows), original);
});

test("tablica przekazuje rekordy do właściwych kolumn i pokazuje liczby oraz kolory kart", () => {
  const { PipelineBoard } = loadModule(
    "src/components/pipeline/pipeline-board.tsx",
  );
  const rows = LEAD_STATUSES.map((status, index) =>
    lead({
      id: String(index),
      status: status.value,
      follow_up_date: ["won", "lost"].includes(status.value)
        ? null
        : "2026-11-17",
    }),
  );
  const html = renderToStaticMarkup(
    createElement(PipelineBoard, { leads: rows }),
  );
  assert.equal((html.match(/<article\b/g) || []).length, 7);
  assert.equal((html.match(/aria-haspopup="dialog"/g) || []).length, 7);
  assert.equal((html.match(/Liczba leadów: 1/g) || []).length, 7);
  assert.equal(html.includes("Nie ma jeszcze klientów"), false);
  for (const status of LEAD_STATUSES)
    assert.ok(html.includes("border-left-color:" + status.color));
});

test("główny kontakt preferuje Instagram, a następnie e-mail i telefon", () => {
  assert.equal(
    pipeline.getPrimaryContact(
      lead({ instagram: " @profil ", email: "kontakt@example.invalid" }),
    ).value,
    "@profil",
  );
  assert.equal(
    pipeline.getPrimaryContact(
      lead({ instagram: "  ", email: "kontakt@example.invalid" }),
    ).label,
    "E-mail",
  );
  assert.equal(pipeline.getPrimaryContact(lead()).label, "Telefon");
  assert.equal(pipeline.getPrimaryContact(lead({ phone: null })), null);
});

test("zaległość używa daty w Warszawie; dzisiejszy i zamknięty lead nie są zaległe", () => {
  const today = pipeline.getTodayInWarsaw(new Date("2026-11-17T23:30:00Z"));
  assert.equal(today, "2026-11-18");
  assert.equal(
    pipeline.isFollowUpOverdue(lead({ follow_up_date: "2026-11-17" }), today),
    true,
  );
  assert.equal(
    pipeline.isFollowUpOverdue(lead({ follow_up_date: today }), today),
    false,
  );
  assert.equal(
    pipeline.isFollowUpOverdue(lead({ follow_up_date: null }), today),
    false,
  );
  assert.equal(
    pipeline.isFollowUpOverdue(
      lead({ status: "won", follow_up_date: "2026-01-01" }),
      today,
    ),
    false,
  );
  assert.ok(pipeline.formatFollowUpDate("2026-11-17").includes("17"));
});

test("karta pomija puste pola, pokazuje zero i oznaczenie zaległości oraz kolorowy pasek", () => {
  const { LeadCard } = loadModule("src/components/pipeline/lead-card.tsx");
  const basic = renderToStaticMarkup(
    LeadCard({
      lead: lead({ service_type: "  ", status: "won", follow_up_date: null }),
      status: LEAD_STATUSES[5],
      today: "2026-11-18",
    }),
  );
  assert.equal(basic.includes("Rodzaj usługi"), false);
  assert.equal(basic.includes("Orientacyjna wartość"), false);
  assert.equal(basic.includes("Następny follow-up"), false);
  assert.ok(basic.includes("Nie zaplanowano follow-upu"));
  const complete = renderToStaticMarkup(
    LeadCard({
      lead: lead({
        company_name: "<script>nazwa</script>",
        service_type: "Usługa z rekordu",
        estimated_value: 0,
      }),
      status: LEAD_STATUSES[0],
      today: "2026-11-18",
    }),
  );
  assert.ok(complete.includes("border-left-color:#64748b"));
  assert.ok(complete.includes("Usługa z rekordu"));
  assert.match(complete, /0\s*zł/);
  assert.ok(complete.includes('dateTime="2026-11-17"'));
  assert.ok(complete.includes("Zaległy"));
  assert.equal(complete.includes("<script>"), false);
});

function queryHarness(responses, claims = { sub: "owner-id" }) {
  const calls = [];
  let page = 0;
  const builder = {};
  for (const method of ["schema", "from", "select", "eq", "order", "range"]) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.overrideTypes = async () => {
    const response = responses[page++];
    if (response instanceof Error) throw response;
    assert.ok(response, "Nieoczekiwane dodatkowe żądanie");
    return response;
  };
  const query = loadModule("src/lib/leads/queries.ts", {
    "@/lib/auth/session": { getAuthenticatedClaims: async () => claims },
    "@/lib/supabase/server": { createClient: async () => builder },
    "next/navigation": {
      redirect: (destination) => {
        const error = new Error("redirect");
        error.destination = destination;
        throw error;
      },
    },
  });
  return { ...query, calls };
}

test("odczyt jest ograniczony do właściciela i pobiera kolejne zakresy bez ucinania wyniku", async () => {
  const query = queryHarness([
    { data: [lead({ id: "a" })], error: null, count: 2 },
    { data: [lead({ id: "b" })], error: null, count: 2 },
  ]);
  const result = await query.getPipelineLeads();
  assert.equal(result.ok, true);
  assert.equal(result.leads.length, 2);
  assert.ok(query.calls.find(([method]) => method === "select")[1].includes("updated_at"));
  assert.ok(
    query.calls.some(
      ([method, value]) => method === "schema" && value === "public",
    ),
  );
  assert.ok(
    query.calls.some(
      ([method, value]) => method === "from" && value === "leads",
    ),
  );
  assert.ok(
    query.calls
      .filter(([method]) => method === "eq")
      .every(
        ([, column, value]) => column === "user_id" && value === "owner-id",
      ),
  );
  assert.deepEqual(
    query.calls.filter(([method]) => method === "range"),
    [
      ["range", 0, 499],
      ["range", 1, 500],
    ],
  );
  assert.ok(
    query.calls.some(
      ([method, column, options]) =>
        method === "order" &&
        column === "follow_up_date" &&
        options.ascending &&
        !options.nullsFirst,
    ),
  );
});

test("pusty wynik jest sukcesem, ale błędy i niepełne wyniki nim nie są", async () => {
  const empty = await queryHarness([
    { data: [], error: null, count: 0 },
  ]).getPipelineLeads();
  assert.equal(empty.ok, true);
  assert.equal(empty.leads.length, 0);
  for (const response of [
    { data: null, error: { code: "42501" }, count: null },
    { data: [], error: null, count: null },
    { data: [], error: null, count: 1 },
    { data: [lead({ status: "unknown" })], error: null, count: 1 },
    new Error("offline"),
  ]) {
    assert.equal((await queryHarness([response]).getPipelineLeads()).ok, false);
  }
  const partial = queryHarness([
    { data: [lead()], error: null, count: 2 },
    { data: null, error: { code: "network" }, count: null },
  ]);
  const result = await partial.getPipelineLeads();
  assert.equal(result.ok, false);
  assert.equal("leads" in result, false);
});

test("brak tożsamości przekierowuje do logowania przed zapytaniem do tabeli", async () => {
  const query = queryHarness([], null);
  await assert.rejects(
    query.getPipelineLeads(),
    (error) => error.destination === "/login?next=%2Fpipeline",
  );
  assert.equal(query.calls.length, 0);
});

test("błąd odczytu pokazuje komunikat i działający link ponowienia zamiast pustych kolumn", async () => {
  const page = loadModule("src/app/(crm)/pipeline/page.tsx", {
    "@/lib/leads/queries": { getPipelineLeads: async () => ({ ok: false }) },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  });
  const html = renderToStaticMarkup(await page.default());
  assert.ok(html.includes("Nie udało się pobrać leadów"));
  assert.ok(html.includes('href="/pipeline"'));
  assert.equal(html.includes("Nie ma jeszcze klientów"), false);
  assert.equal(html.includes("Liczba leadów: 0"), false);
});

test("brak terminu nigdy nie wyprzedza daty, nawet 9999-12-31, i nie jest zaległy", () => {
  const rows = [
    lead({ id: "a", follow_up_date: null }),
    lead({ id: "z", follow_up_date: "9999-12-31" }),
  ];
  assert.deepEqual(
    Array.from(pipeline.groupPipelineLeads(rows)[0].leads, (entry) => entry.id),
    ["z", "a"],
  );
  assert.equal(pipeline.isFollowUpOverdue(rows[0], "2026-11-17"), false);
});
