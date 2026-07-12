"use client";

import { useState, useEffect } from "react";
import { ipfsCandidates } from "@/lib/ipfs";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** ipfs:// uri or a plain http/data url */
  uri: string;
};

/**
 * <img> that resolves IPFS via fast gateways and automatically falls back to the
 * next gateway if one errors, so a single slow/failing gateway never leaves a
 * broken or forever-loading image.
 *
 * While the first (uncached) fetch is in flight it shows a shimmer skeleton, then
 * fades the image in on load, so a slow gateway never looks like a blank box.
 */
export function IpfsImage({ uri, alt = "", className = "", ...rest }: Props) {
  const candidates = ipfsCandidates(uri);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Reset when the source changes
  useEffect(() => { setIdx(0); setLoaded(false); }, [uri]);

  const src = candidates[idx] ?? "";
  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setIdx((i) => (i + 1 < candidates.length ? i + 1 : i))}
      className={`${className} ${loaded ? "ipfs-loaded" : "ipfs-loading"}`.trim()}
      {...rest}
    />
  );
}
