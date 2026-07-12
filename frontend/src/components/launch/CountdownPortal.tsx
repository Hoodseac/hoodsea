"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LAUNCH_TS } from "@/lib/launchGate";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function CountdownPortal() {
  const [remaining, setRemaining] = useState(() => Math.max(0, LAUNCH_TS - Date.now()));

  useEffect(() => {
    const iv = setInterval(() => setRemaining(Math.max(0, LAUNCH_TS - Date.now())), 1000);
    return () => clearInterval(iv);
  }, []);

  const totalSec = Math.floor(remaining / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const units = [
    { label: "DAYS", value: pad(days) },
    { label: "HOURS", value: pad(hours) },
    { label: "MINUTES", value: pad(mins) },
    { label: "SECONDS", value: pad(secs) },
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden px-5"
      style={{ backgroundImage: "url(/landing/sky.webp)", backgroundSize: "cover", backgroundPosition: "center" }}
    >
      {/* Soft light wash to keep the text crisp on the pastel sky */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-white/0 to-mint/60" />

      <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
        {/* Portal hero with a gentle float + violet glow */}
        <div className="relative mb-7 flex justify-center">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sea/30 blur-3xl"
            animate={{ opacity: [0.45, 0.8, 0.45], scale: [0.9, 1.08, 0.9] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.img
            src="/landing/portal4.webp"
            alt="Hoodsea portal"
            className="relative w-[min(72vw,360px)] drop-shadow-[0_24px_55px_rgba(0,200,5,0.4)]"
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Kicker + headline */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <span className="inline-block rounded-full border border-white/60 bg-white/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent backdrop-blur-md">
            Public Testnet
          </span>
          <h1
            className="mt-4 text-3xl font-bold text-ink sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            The portal opens in
          </h1>
        </motion.div>

        {/* Countdown, glass cards beneath the portal */}
        <div className="mt-7 grid grid-cols-4 gap-2.5 sm:gap-4">
          {units.map((u, i) => (
            <motion.div
              key={u.label}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.08, ease: "easeOut" }}
              className="flex flex-col items-center rounded-2xl border border-white/60 bg-white/45 px-2 py-3 shadow-[0_10px_30px_rgba(79,70,229,0.18)] backdrop-blur-md sm:px-5 sm:py-4"
            >
              <span className="font-mono text-3xl font-bold tabular-nums text-ink sm:text-5xl">
                {u.value}
              </span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-secondary sm:text-[11px]">
                {u.label}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Date + chain */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-7 flex flex-col items-center gap-2"
        >
          <p className="text-sm font-semibold text-ink">June 17, 2026 · 00:00 UTC</p>
          <div className="flex items-center gap-2 rounded-full border border-white/60 bg-white/35 px-3 py-1 backdrop-blur-md">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-[11px] font-semibold text-accent">Launching on Robinhood Chain</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
