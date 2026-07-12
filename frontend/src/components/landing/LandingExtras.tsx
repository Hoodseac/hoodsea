"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const SIGNATURE = [0.22, 1, 0.36, 1] as const;

// Hoodsea palette
const UP = "#00C805"; // brand green
const DOWN = "#FF494A"; // loss red
const UP_WICK = "#7BE38C";
const DOWN_WICK = "#FF9B9C";

/**
 * Primehod-style scroll reveal: fades children up into view once, with a
 * staggered delay for grouped items. Signature ease, reduced-motion aware.
 */
export function FadeInUp({ children, index = 0, className }: { children: React.ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, delay: (index % 3) * 0.06, ease: SIGNATURE }}
    >
      {children}
    </motion.div>
  );
}

/** Same reveal but fires on mount (for above-the-fold hero content). */
export function MountUp({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: SIGNATURE }}
    >
      {children}
    </motion.div>
  );
}

/** NFT trading candle chart, Hoodsea palette: green up, red down on the ivory card. */
export function CandleChart() {
  const reduce = useReducedMotion();
  const losses = ["-92%", "-85%", "-97%", "-100%", "-78%"];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduce) return; // hold the first figure when motion is reduced
    const t = setInterval(() => setIdx((i) => (i + 1) % losses.length), 2600);
    return () => clearInterval(t);
  }, [reduce]);

  const candles = [
    { x: 6, h: 26, dir: -1 }, { x: 20, h: 18, dir: -1 }, { x: 34, h: 30, dir: -1 },
    { x: 48, h: 14, dir: 1 }, { x: 62, h: 34, dir: -1 }, { x: 76, h: 22, dir: -1 },
    { x: 90, h: 40, dir: -1 }, { x: 104, h: 16, dir: 1 },
  ];

  return (
    <div className="rounded-2xl border border-white/50 bg-white/25 backdrop-blur-md p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Typical rug chart</span>
        <motion.span
          key={idx}
          initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="text-sm font-bold font-mono"
          style={{ color: DOWN }}
        >
          {losses[idx]}
        </motion.span>
      </div>
      <svg viewBox="0 0 120 56" className="w-full h-24" aria-hidden>
        {candles.map((c, i) => (
          <g key={i}>
            <line x1={c.x + 3} x2={c.x + 3} y1={28 - c.h / 2} y2={28 + c.h / 2}
              stroke={c.dir < 0 ? DOWN_WICK : UP_WICK} strokeWidth="1" />
            <rect x={c.x} y={c.dir < 0 ? 28 - c.h / 3 : 28} width="6" height={c.h / 2.2} rx="1"
              fill={c.dir < 0 ? DOWN : UP} opacity="0.9" />
          </g>
        ))}
        <motion.path
          d="M3 14 L17 18 L31 12 L45 26 L59 22 L73 34 L87 30 L101 46 L115 44"
          fill="none" stroke={DOWN} strokeWidth="1.5" strokeLinecap="round" opacity="0.5"
          initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
          transition={{ duration: 1.6, ease: SIGNATURE }}
        />
      </svg>
    </div>
  );
}
