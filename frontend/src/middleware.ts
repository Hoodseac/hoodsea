import { NextRequest, NextResponse } from "next/server";

// Single domain. The marketing landing lives at the clean root URL (/), plus
// /docs and /news; the app lives at /explore etc. on the same host. We rewrite
// the marketing paths to /landing/* internally so the browser URL stays clean,
// and flag those requests with x-hoodsea-landing so the root layout swaps in the
// landing chrome (and hides the app navbar). Any bare /landing* URL redirects
// back to the clean path so /landing never shows in the address bar.

const REWRITES: Record<string, string> = {
  "/": "/landing",
  "/docs": "/landing/docs",
  "/news": "/landing/news",
};

const REDIRECTS: Record<string, string> = {
  "/landing": "/",
  "/landing/docs": "/docs",
  "/landing/news": "/news",
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Farcaster Mini App manifest served as-is.
  if (pathname.startsWith("/.well-known")) return NextResponse.next();

  // Never show /landing in the address bar.
  if (REDIRECTS[pathname]) {
    const url = req.nextUrl.clone();
    url.pathname = REDIRECTS[pathname];
    return NextResponse.redirect(url);
  }

  const target = REWRITES[pathname];
  if (target) {
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-hoodsea-landing", "1");
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url, { request: { headers: reqHeaders } });
  }

  return NextResponse.next();
}

export const config = {
  // skip static assets and api proxy paths
  matcher: ["/((?!_next/|api/|favicon.ico|og.png|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)).*)"],
};
