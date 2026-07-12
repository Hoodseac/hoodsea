// src/lib/ipfs.ts
// Permanent storage helpers. Primary path is server-side Irys via profileapi;
// Pinata (IPFS) is the automatic fallback.

const PINATA_JWT = process.env.NEXT_PUBLIC_PINATA_JWT || "";

// Storage backend. Uploads go to Irys (Arweave, permanent) through our own
// profileapi endpoint, which signs + pays from a server wallet, so the USER
// never signs or funds anything. Users on Robinhood Chain (4663) cannot pay
// Irys directly (Irys does not accept this chain's ETH), so the old
// client-signed Irys path is gone. Pinata stays as an automatic fallback if
// the endpoint is ever unreachable. Photos are compressed to a sharp HD WebP
// first (see imgcompress).
const USE_IRYS_SERVER = true;

// Images load through our own server cache first (local disk + immutable
// browser cache = effectively instant, and never the 403/rate-limit/5-10s
// hangs of public gateways). The cache endpoint races every gateway on a miss,
// stores the bytes, and serves instantly thereafter. Public gateways stay as a
// fallback in case the server is ever down.
const PROFILE_API = (process.env.NEXT_PUBLIC_PROFILE_API || "").replace(/\/$/, "");
const VPS_CACHE = PROFILE_API ? `${PROFILE_API}/api/img` : "";
const FAST_GATEWAYS = ["https://ipfs.io", "https://nftstorage.link", "https://dweb.link"];
export const IPFS_GATEWAYS = [VPS_CACHE, ...FAST_GATEWAYS].filter((v, i, a) => v && a.indexOf(v) === i);

/** Read a Blob as a base64 data URL (the Irys endpoint strips the prefix). */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// POST ${PROFILE_API}/api/irys/upload
// JSON body: { metadata?: object, image?: string (base64), contentType?: string }
// Response: { uri }
async function irysServerUpload(body: object): Promise<string | null> {
  try {
    const res = await fetch(`${PROFILE_API}/api/irys/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.uri || null;
  } catch { return null; }
}

/** Upload bytes to Irys via our server endpoint. Returns a gateway URL, or null on failure. */
async function uploadFileViaServer(file: File): Promise<string | null> {
  const dataUrl = await blobToDataURL(file).catch(() => null);
  if (!dataUrl) return null;
  return irysServerUpload({ image: dataUrl, contentType: file.type || "image/webp" });
}

/** Upload a JSON document to Irys via our server endpoint. Returns a gateway URL, or null. */
async function uploadJSONViaServer(metadata: object): Promise<string | null> {
  return irysServerUpload({ metadata });
}

/**
 * Upload a file to permanent storage.
 * Returns a gateway.irys.xyz URL (Irys/Arweave) or, on fallback, an ipfs:// URI.
 */
export async function uploadToIPFS(file: File): Promise<string> {
  // Compress to a sharp HD WebP first (no wallet signature needed for either path).
  let upload = file;
  try {
    const { compressImage } = await import("./imgcompress");
    upload = await compressImage(file);
  } catch { /* fall back to the original file if compression fails */ }

  // Primary: Irys via our server (permanent, server-paid, no user signature).
  if (USE_IRYS_SERVER) {
    const url = await uploadFileViaServer(upload);
    if (url) return url;
    console.warn("Irys server upload failed, falling back to Pinata");
  }

  if (!PINATA_JWT) {
    // Dev fallback: return object URL (not persisted)
    console.warn("No PINATA_JWT set, using local object URL (dev only)");
    return URL.createObjectURL(file);
  }

  // Pinata fallback: pin the already-compressed WebP (no wallet signature needed).
  const formData = new FormData();
  formData.append("file", upload);
  formData.append(
    "pinataMetadata",
    JSON.stringify({ name: upload.name })
  );
  formData.append(
    "pinataOptions",
    JSON.stringify({ cidVersion: 1 })
  );

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`IPFS upload failed: ${res.statusText}`);
  }

  const data = await res.json();
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Upload a JSON metadata object to permanent storage.
 * Returns a gateway.irys.xyz URL (Irys/Arweave) or, on fallback, an ipfs:// URI.
 */
export async function uploadJSONToIPFS(metadata: object): Promise<string> {
  if (USE_IRYS_SERVER) {
    const url = await uploadJSONViaServer(metadata);
    if (url) return url;
    console.warn("Irys server JSON upload failed, falling back to Pinata");
  }
  if (!PINATA_JWT) {
    return `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
  }

  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: { name: "metadata.json" },
    }),
  });

  if (!res.ok) {
    throw new Error(`IPFS JSON upload failed: ${res.statusText}`);
  }

  const data = await res.json();
  return `ipfs://${data.IpfsHash}`;
}

/**
 * Convert ipfs:// URI to gateway URL for display
 */
export function ipfsToHTTP(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `${IPFS_GATEWAYS[0]}/ipfs/${uri.replace("ipfs://", "")}`;
  }
  return uri; // Already HTTP or data URL
}

/** Every gateway URL for a uri, in priority order, used for onError fallback. */
export function ipfsCandidates(uri: string): string[] {
  if (!uri) return [];
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return IPFS_GATEWAYS.map((g) => `${g}/ipfs/${cid}`);
  }
  return [uri];
}
