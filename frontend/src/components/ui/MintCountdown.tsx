"use client";

import { useEffect, useState } from "react";

interface Props {
  startTime?: number; // unix seconds
  endTime?: number;
  isEnd?: boolean;
  onExpired?: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function MintCountdown({
  startTime = 0,
  endTime = 0,
  isEnd = false,
  onExpired,
}: Props) {
  const target = isEnd ? endTime : startTime;
  const [diff, setDiff] = useState(
    Math.max(0, target - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const iv = setInterval(() => {
      const d = Math.max(0, target - Math.floor(Date.now() / 1000));
      setDiff(d);
      if (d === 0) {
        onExpired?.();
        clearInterval(iv);
      }
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
          <p
            className="text-3xl text-accent"
            style={{
              fontFamily: "var(--font-display)",
              letterSpacing: "0.05em",
            }}
          >
            {pad(v)}
          </p>
          <p className="text-[10px] font-medium text-text-dim uppercase tracking-wide">
            {l}
          </p>
        </div>
      ))}
    </div>
  );
}
