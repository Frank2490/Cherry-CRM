import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSafeRedirect } from "@/lib/auth/redirect";
import { getSupabaseEnv } from "@/lib/supabase/env";

const cacheHeaders = ["cache-control", "expires", "pragma"];

function preserveSession(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  cacheHeaders.forEach((name) => {
    const value = source.headers.get(name);
    if (value) target.headers.set(name, value);
  });
  return target;
}

export async function updateSession(request: NextRequest) {
  const { url, publishableKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = preserveSession(response, NextResponse.next({ request }));
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && Boolean(data?.claims.sub) && !data?.claims.is_anonymous;
  } catch {
    // Przy niedostępności Auth dostęp do chronionych tras pozostaje zamknięty.
  }

  const isLogin = request.nextUrl.pathname === "/login";
  const isRead = request.method === "GET" || request.method === "HEAD";

  if (!authenticated && !isLogin) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/login";
    destination.search = "";
    destination.searchParams.set("next", getSafeRedirect(request.nextUrl.pathname));
    return preserveSession(
      response,
      NextResponse.redirect(destination, isRead ? 307 : 303),
    );
  }

  if (authenticated && isLogin && isRead) {
    const destination = request.nextUrl.clone();
    destination.pathname = getSafeRedirect(request.nextUrl.searchParams.get("next"));
    destination.search = "";
    return preserveSession(response, NextResponse.redirect(destination));
  }

  return response;
}
