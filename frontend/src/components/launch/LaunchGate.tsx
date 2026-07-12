"use client";

import { useEffect, useState } from "react";
import { LAUNCH_TS, PREVIEW_KEY, PREVIEW_FLAG } from "@/lib/launchGate";
import { CountdownPortal } from "./CountdownPortal";

/**
 * Gates the whole site behind a countdown portal until LAUNCH_TS.
 * Initial render is deterministic (pre-launch on both server and client => gated)
 * so there is no hydration mismatch and no flash of the real site to the public.
 * The team unlocks a preview with ?preview=<PREVIEW_KEY> (stored in localStorage);
 * ?preview=off clears it.
 */
export function LaunchGate({ children }: { children: React.ReactNode }) {
  const [gated, setGated] = useState(() => Date.now() < LAUNCH_TS);

  useEffect(() => {
    // Preview bypass
    try {
      const p = new URLSearchParams(window.location.search).get("preview");
      if (p === "off") localStorage.removeItem(PREVIEW_FLAG);
      else if (p && PREVIEW_KEY && p === PREVIEW_KEY) localStorage.setItem(PREVIEW_FLAG, "1");
      if (localStorage.getItem(PREVIEW_FLAG) === "1") {
        setGated(false);
        return;
      }
    } catch {}

    // Otherwise track the clock and open automatically at launch
    const tick = () => setGated(Date.now() < LAUNCH_TS);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  if (gated) return <CountdownPortal />;
  return <>{children}</>;
}
