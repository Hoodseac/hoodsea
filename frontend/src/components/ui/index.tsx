// ─── LiveTicker.tsx ──────────────────────────────────────────────────────────
"use client";
import { motion } from "framer-motion";

const MOCK_EVENTS = [
  "CryptoPunk DAO minted 3/100",
  "$PIXL token deployed, MC $10k",
  "ApeVault bonding 78/100",
  "Mythic NFT #3 minted",
  "$REEF sold 100%, bonded",
];

export function LiveTicker() {
  const items = [...MOCK_EVENTS, ...MOCK_EVENTS]; // duplicate for seamless loop
  return (
    <div className="border-y border-border bg-surface/50 py-2 overflow-hidden">
      <motion.div
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="flex whitespace-nowrap"
      >
        {items.map((event, i) => (
          <span key={i} className="text-xs font-medium text-text-secondary mx-8">
            {event}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ─── MintCountdown.tsx ────────────────────────────────────────────────────────
"use client";
import { useEffect, useState } from "react";

interface Props {
  startTime?: number; // unix seconds
  endTime?: number;
  isEnd?: boolean;
  onExpired?: () => void;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

export function MintCountdown({ startTime = 0, endTime = 0, isEnd = false, onExpired }: Props) {
  const target = isEnd ? endTime : startTime;
  const [diff, setDiff] = useState(Math.max(0, target - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const iv = setInterval(() => {
      const d = Math.max(0, target - Math.floor(Date.now() / 1000));
      setDiff(d);
      if (d === 0) { onExpired?.(); clearInterval(iv); }
    }, 1000);
    return () => clearInterval(iv);
  }, [target, onExpired]);

  const days = Math.floor(diff / 86400);
  const hrs = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;

  return (
    <div className="flex gap-4">
      {[
        { v: days, l: "DAYS" },
        { v: hrs, l: "HRS" },
        { v: mins, l: "MIN" },
        { v: secs, l: "SEC" },
      ].map(({ v, l }) => (
        <div key={l} className="text-center">
          <p className="text-3xl font-bold tabular-nums tracking-tight text-ink">
            {pad(v)}
          </p>
          <p className="text-[10px] font-medium text-text-dim uppercase tracking-wide">{l}</p>
        </div>
      ))}
    </div>
  );
}

// ─── DateTimePicker.tsx ───────────────────────────────────────────────────────
"use client";

interface Props {
  value: Date | null;
  onChange: (d: Date) => void;
  minDate?: Date;
}

export function DateTimePicker({ value, onChange, minDate }: Props) {
  const toInputValue = (d: Date | null) => {
    if (!d) return "";
    // Format as local datetime-local string
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const minStr = minDate ? toInputValue(minDate) : undefined;

  return (
    <input
      type="datetime-local"
      className="input-base"
      value={toInputValue(value)}
      min={minStr}
      onChange={(e) => {
        if (e.target.value) onChange(new Date(e.target.value));
      }}
      style={{ colorScheme: "light" }}
    />
  );
}
