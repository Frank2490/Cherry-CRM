import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isLeadId } from "@/lib/leads/details";
import { getSupabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";

const maxBodyBytes = 64 * 1024;
const tokenFormat = /^[A-Za-z0-9_-]{32,256}$/;
const leadFields = new Set(["company_name", "instagram", "status", "notes", "next_step"]);
const instagramProfile = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([a-z0-9_.]{1,30})\/?(?:[?#][^\s]*)?$/i;
const instagramHandle = /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/i;

function errorResponse(status: number, code: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (status === 401) headers.set("WWW-Authenticate", "Bearer");
  return Response.json({ result: "error", code }, { status, headers });
}

function hasImportToken(header: string | null, expected: string) {
  const provided = /^Bearer +([A-Za-z0-9_-]{32,256})$/i.exec(header ?? "")?.[1];
  if (!provided) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

async function readJson(request: Request) {
  if (Number(request.headers.get("content-length")) > maxBodyBytes)
    return { ok: false, response: errorResponse(413, "payload_too_large") } as const;

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: errorResponse(400, "invalid_json") } as const;

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        return { ok: false, response: errorResponse(413, "payload_too_large") } as const;
      }
      body += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(body + decoder.decode());
    return { ok: true, data } as const;
  } catch {
    void reader.cancel().catch(() => {});
    return { ok: false, response: errorResponse(400, "invalid_json") } as const;
  } finally {
    reader.releaseLock();
  }
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength
    && !value.includes("\0") && value.isWellFormed();
}

function validateLead(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (Object.keys(data).some((key) => !leadFields.has(key))) return null;

  const { company_name, instagram, status, notes, next_step } = data as Record<string, unknown>;
  if (status !== "new" || !isText(company_name, 200) || !isText(instagram, 500)
    || !isText(notes, 12_000) || (next_step != null && !isText(next_step, 1_000)))
    return null;

  const company = company_name.trim().replace(/\s+/g, " ");
  const profile = instagram.trim();
  const handle = instagramProfile.exec(profile)?.[1] ?? profile.replace(/^@/, "");
  if (!company || !instagramHandle.test(handle) || handle.includes("..")) return null;

  return {
    p_company_name: company,
    p_instagram: handle.toLowerCase(),
    p_notes: notes,
    p_next_step: next_step?.trim() || null,
  };
}

export async function POST(request: Request) {
  const expectedToken = process.env.CHERRY_LEAD_IMPORT_TOKEN;
  if (!expectedToken || !tokenFormat.test(expectedToken))
    return errorResponse(503, "import_unavailable");
  if (!hasImportToken(request.headers.get("authorization"), expectedToken))
    return errorResponse(401, "unauthorized");

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return errorResponse(415, "unsupported_media_type");

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const payload = validateLead(body.data);
  if (!payload) return errorResponse(422, "invalid_payload");

  const ownerId = process.env.CHERRY_LEAD_IMPORT_OWNER_ID?.trim().toLowerCase();
  const email = process.env.CHERRY_LEAD_IMPORT_OWNER_EMAIL?.trim();
  const password = process.env.CHERRY_LEAD_IMPORT_OWNER_PASSWORD;
  if (!isLeadId(ownerId) || !email || !password) return errorResponse(503, "import_unavailable");

  try {
    const { url, publishableKey } = getSupabaseEnv();
    const supabase = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !auth.session?.access_token || auth.user?.id !== ownerId || auth.user.is_anonymous)
      return errorResponse(503, "import_unavailable");

    const { data, error } = await supabase.rpc("import_instagram_lead", payload);
    if (error || (data !== "created" && data !== "already_exists"))
      return errorResponse(503, "import_unavailable");

    return Response.json({ result: data }, {
      status: data === "created" ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return errorResponse(503, "import_unavailable");
  }
}
