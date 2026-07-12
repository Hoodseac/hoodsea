"use client";

import Link from "next/link";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { shortAddr, type Identity } from "@/lib/profiles";

// Renders a wallet identity: avatar + username (or short address).
// Set linkToProfile to make the avatar+name link to the public profile page.
// (Only use it where the cell is not already nested inside another link.)
// The underlying wallet address is always copyable: when there is no username the
// short address itself is the copy button; when a username is shown a small copy
// icon sits beside it so the address can still be grabbed.
export function IdentityCell({ address, identity, linkToProfile = false }: { address: string; identity?: Identity; linkToProfile?: boolean }) {
  const name = identity?.username || shortAddr(address);
  const avatar = identity?.avatar || null;

  const avatarEl = avatar ? (
    <IpfsImage uri={avatar} alt={name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
  ) : (
    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber/40 to-amber/10 flex-shrink-0" />
  );

  // Name element: a username (or the short address as a fallback label).
  const nameEl = (
    <span className={`text-sm truncate ${identity?.username ? "font-semibold text-text-primary" : "font-mono text-text-primary"}`}>
      {name}
    </span>
  );

  return (
    <div className="flex items-center gap-2 min-w-0">
      {linkToProfile ? (
        <Link href={`/u/${address}`} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          {avatarEl}
          {nameEl}
        </Link>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          {avatarEl}
          {nameEl}
        </div>
      )}
      {/* Always let the wallet address be copied. If the label already IS the
          address (no username) it is redundant with the text, but keeping it as a
          small icon everywhere is consistent and unobtrusive. */}
      <CopyAddress address={address} iconOnly iconSize={12} title="Copy wallet address" className="flex-shrink-0" />
    </div>
  );
}
