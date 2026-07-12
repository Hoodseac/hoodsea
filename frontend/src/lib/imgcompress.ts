// Client-side image compressor. Re-encodes any image to a sharp HD WebP,
// quality-first: caps the longest side at 2048px and keeps quality high, only
// nudging it down to land under a generous soft cap, never below a floor that
// would look soft. Storage is Irys (paid per byte, but fractions of a cent), so
// HD is the priority, not a hard size limit. Non-image files pass through.

export interface CompressOpts {
  targetBytes?: number; // soft cap; we try to land under this (HD-friendly)
  maxDimension?: number; // longest side cap (px)
  minDimension?: number; // never shrink below this
  startQuality?: number; // initial WebP quality
  minQuality?: number; // quality floor (avoid "burik")
}

const DEFAULTS: Required<CompressOpts> = {
  targetBytes: 1_500_000, // ~1.5MB soft cap, only huge photos get trimmed
  maxDimension: 2048,
  minDimension: 1536,
  startQuality: 0.92,
  minQuality: 0.82,
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", quality),
  );
}

function drawScaled(img: HTMLImageElement, longest: number): HTMLCanvasElement {
  const scale = Math.min(1, longest / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/**
 * Compress an image to a small, still-sharp WebP. Returns a new File (.webp).
 * If `file` is not an image, it is returned unchanged.
 */
export async function compressImage(file: File, opts: CompressOpts = {}): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  const o = { ...DEFAULTS, ...opts };

  let img: HTMLImageElement;
  try { img = await loadImage(file); } catch { return file; }

  // Keep it HD: try high quality at full resolution first, only easing quality
  // (keeps resolution = sharper) then shrinking if a photo is enormous. Floors
  // at 1536px / q0.82 so it never looks soft.
  const dims = [o.maxDimension, 1792, o.minDimension];
  const qualities = [o.startQuality, 0.88, 0.85, o.minQuality];
  let best: Blob | null = null;
  outer:
  for (const d of dims) {
    const canvas = drawScaled(img, d);
    for (const q of qualities) {
      const blob = await canvasToBlob(canvas, q);
      best = blob;
      if (blob.size <= o.targetBytes) break outer;
    }
    if (d <= o.minDimension) break; // hit the floor; keep the smallest we got
  }

  if (!best) return file;
  // If somehow the WebP is bigger than the original, keep the original.
  if (best.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
  return new File([best], name, { type: "image/webp" });
}
