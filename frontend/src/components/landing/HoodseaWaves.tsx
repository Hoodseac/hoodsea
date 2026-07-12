"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Hoodsea ambient motion, Primehod-style restraint in the Robinhood palette.
 * No bobbing, no bubbles: a faint grid, one slow-breathing green glow, a single
 * horizontal wave line, and a hero mark that settles once and then rests.
 * Pure SVG/CSS, self-contained. Light theme only, reduced-motion aware.
 */

const SIGNATURE = [0.22, 1, 0.36, 1] as const; // signature ease
const GREEN = "#00C805";
const LIME = "#CEF606";

/**
 * Hero backdrop: a faint hairline grid masked to a soft radial vignette, plus
 * one very-low-opacity green/lime glow that drifts and breathes slowly, like
 * deep-sea light. Barely perceptible: felt, not noticed.
 */
export function HeroBackdrop() {
  const reduce = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Faint hairline grid, radial-masked to fade out at the edges */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(5,6,0,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(5,6,0,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(60% 60% at 50% 34%, black, transparent 78%)",
          WebkitMaskImage: "radial-gradient(60% 60% at 50% 34%, black, transparent 78%)",
        }}
      />
      {/* Slow deep-sea glow: horizontal drift + gentle breathe, no vertical loop */}
      <motion.div
        className="absolute left-1/2 top-[34%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(0,200,5,0.16), rgba(206,246,6,0.06) 45%, rgba(244,247,236,0) 72%)",
          filter: "blur(24px)",
        }}
        animate={reduce ? undefined : { x: [-26, 26, -26], scale: [1, 1.07, 1], opacity: [0.55, 0.8, 0.55] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/**
 * The hero centerpiece: the wave mark fades and scales in once with the
 * signature ease, a single ripple expands on entrance, then everything rests.
 */
export function HeroWaveScene() {
  const reduce = useReducedMotion();

  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-md items-center justify-center" aria-hidden>
      {/* Subtle green halo behind the mark */}
      <div
        className="absolute h-56 w-56 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(0,200,5,0.14), rgba(244,247,236,0) 70%)" }}
      />

      {/* Single ripple on entrance (expands once, then gone) */}
      {!reduce && (
        <motion.span
          className="absolute rounded-full"
          style={{ border: "1px solid rgba(0,200,5,0.3)" }}
          initial={{ width: 210, height: 210, opacity: 0.5 }}
          animate={{ width: 370, height: 370, opacity: 0 }}
          transition={{ duration: 1.5, ease: SIGNATURE, delay: 0.35 }}
        />
      )}

      {/* Wave mark in a crisp ink tile (the brand lockup) — clean, no blur */}
      <motion.div
        className="relative flex items-center justify-center rounded-[2rem] bg-ink"
        style={{ width: 210, height: 210, boxShadow: "0 34px 64px -26px rgba(0,200,5,0.5)" }}
        initial={reduce ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: SIGNATURE }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hoodsea-logo.png" alt="" className="w-3/5" />
      </motion.div>
    </div>
  );
}

/**
 * A single thin wave line that drifts only horizontally, very slowly. Used as a
 * minimal ocean-surface divider between sections. No vertical motion.
 */
export function WaveLine({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();

  const Tile = () => (
    <svg
      viewBox="0 0 720 40"
      preserveAspectRatio="none"
      className="block h-full"
      style={{ width: "50%", flexShrink: 0 }}
      aria-hidden
    >
      {/* Two stacked hairline strokes; slopes match at the seams so it tiles */}
      <path
        d="M0,22 C120,10 240,10 360,22 C480,34 600,34 720,22"
        fill="none"
        stroke={GREEN}
        strokeOpacity="0.28"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0,26 C120,15 240,15 360,26 C480,37 600,37 720,26"
        fill="none"
        stroke={LIME}
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );

  return (
    <div className={`relative w-full overflow-hidden ${className}`} style={{ height: 40 }} aria-hidden>
      <motion.div
        className="absolute inset-y-0 left-0 flex"
        style={{ width: "200%" }}
        animate={reduce ? undefined : { x: ["0%", "-50%"] }}
        transition={{ duration: 44, repeat: Infinity, ease: "linear" }}
      >
        <Tile />
        <Tile />
      </motion.div>
    </div>
  );
}

// Small, still ocean marks that replace the old floating vault/orb/coin/book art.
const MARKS = {
  crest: (
    <>
      <path d="M6 24 Q14 18 22 24 T38 24 T54 24" fill="none" stroke={LIME} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M8 36 Q16 30 24 36 T40 36 T56 36" fill="none" stroke={GREEN} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M6 48 Q14 42 22 48 T38 48 T54 48" fill="none" stroke="#00953F" strokeWidth="3.5" strokeLinecap="round" />
    </>
  ),
  bubbles: (
    <>
      <circle cx="24" cy="44" r="9" fill="rgba(0,200,5,0.14)" stroke={GREEN} strokeWidth="2.5" />
      <circle cx="42" cy="32" r="6.5" fill="rgba(206,246,6,0.25)" stroke={GREEN} strokeWidth="2.5" />
      <circle cx="32" cy="20" r="4.5" fill="rgba(0,200,5,0.14)" stroke="#00953F" strokeWidth="2.5" />
    </>
  ),
  tide: (
    <>
      <path d="M6 40 Q20 28 32 40 T58 40 L58 58 L6 58 Z" fill="rgba(0,200,5,0.16)" />
      <path d="M6 40 Q20 28 32 40 T58 40" fill="none" stroke={GREEN} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="44" cy="22" r="6.5" fill="rgba(206,246,6,0.5)" stroke={GREEN} strokeWidth="2" />
    </>
  ),
  drop: (
    <>
      <path
        d="M32 12 C40 26 45 33 45 40 a13 13 0 1 1 -26 0 C19 33 24 26 32 12 Z"
        fill="rgba(0,200,5,0.14)"
        stroke={GREEN}
        strokeWidth="2.5"
      />
      <path d="M8 52 Q20 46 32 52 T56 52" fill="none" stroke="#00953F" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
};

export type MarkVariant = keyof typeof MARKS;

/** Small, static ocean-themed mark for the pillar cards. No looping motion. */
export function WaveMark({ variant, className }: { variant: MarkVariant; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      {MARKS[variant]}
    </svg>
  );
}
