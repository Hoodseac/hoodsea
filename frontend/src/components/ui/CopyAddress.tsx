"use client";

import { useState, useCallback } from "react";
import { copyToClipboard } from "@/lib/share";
import { shortAddr } from "@/lib/profiles";

// Single, site-wide "click to copy an address" primitive. Anywhere the user
// sees a blockchain address (token CA, NFT collection, wallet, holder, creator,
// trader, minter, snapshot recipient, etc.) it should render through this so the
// copy behaviour and feedback stay identical everywhere.
//
// Feedback pattern (chosen once, used everywhere): an inline copy icon that
// swaps to an accent-green check for ~1.3s. No toast, no layout shift.
//
// It is always a real <button>, keyboard focusable with a visible focus ring and
// an aria-label, so it is accessible. On click it calls preventDefault() +
// stopPropagation() so an address sitting inside a parent <Link>/clickable card
// copies instead of navigating.

const CopyGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckGlyph = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export interface CopyAddressProps {
  /** The full 0x address that gets copied. */
  address: string;
  /** What to render as the visible label. Defaults to a shortened 0x1234…abcd. */
  display?: React.ReactNode;
  /** When true (default) and no `display` is given, show the shortened address. Pass false to show the full address. */
  short?: boolean;
  /** Extra classes for the text + icon button (colour, size, etc.). */
  className?: string;
  /** Render just the copy icon (no address text). For sitting next to an existing link. */
  iconOnly?: boolean;
  /** Icon pixel size. Default 12. */
  iconSize?: number;
  /** Tooltip / aria label. Default "Copy address". */
  title?: string;
}

export function CopyAddress({
  address,
  display,
  short = true,
  className = "",
  iconOnly = false,
  iconSize = 12,
  title = "Copy address",
}: CopyAddressProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(
    async (e: React.MouseEvent) => {
      // Critical: copy, never navigate, even when nested inside a <Link>/card.
      e.preventDefault();
      e.stopPropagation();
      if (!address) return;
      if (await copyToClipboard(address)) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }
    },
    [address]
  );

  const label = copied ? "Address copied" : title;

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onCopy}
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${copied ? "text-accent" : "text-text-dim hover:text-accent"} ${className}`}
      >
        {copied ? <CheckGlyph size={iconSize} /> : <CopyGlyph size={iconSize} />}
      </button>
    );
  }

  const text = display ?? (short ? shortAddr(address) : address);

  return (
    <button
      type="button"
      onClick={onCopy}
      title={label}
      aria-label={label}
      className={`group inline-flex items-center gap-1.5 font-mono rounded transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
    >
      <span>{text}</span>
      <span className={`flex-shrink-0 ${copied ? "text-accent" : "text-text-dim group-hover:text-accent"}`}>
        {copied ? <CheckGlyph size={iconSize} /> : <CopyGlyph size={iconSize} />}
      </span>
    </button>
  );
}
