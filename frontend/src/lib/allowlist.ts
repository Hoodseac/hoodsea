// src/lib/allowlist.ts
// Merkle tree + IPFS helpers for Hoodsea allowlist phases.
// Leaf = keccak256(address), must match contract: keccak256(abi.encodePacked(wallet))

import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { getAddress, isAddress } from "viem";

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

export function parseAddresses(raw: string): string[] {
  if (!raw) return [];
  const parts = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!isAddress(p)) continue;
    const cs = getAddress(p);
    if (seen.has(cs.toLowerCase())) continue;
    seen.add(cs.toLowerCase());
    out.push(cs);
  }
  return out;
}

function leafFor(addr: string): Buffer {
  return keccak256(Buffer.from(addr.slice(2), "hex"));
}

export function buildTree(addresses: string[]): { tree: MerkleTree | null; root: `0x${string}` } {
  if (!addresses || addresses.length === 0) {
    return { tree: null, root: ZERO_ROOT as `0x${string}` };
  }
  const leaves = addresses.map(leafFor);
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = ("0x" + tree.getRoot().toString("hex")) as `0x${string}`;
  return { tree, root };
}

export function getProof(addresses: string[], wallet: string): `0x${string}`[] {
  if (!addresses || addresses.length === 0 || !wallet) return [];
  const { tree } = buildTree(addresses);
  if (!tree) return [];
  const cs = getAddress(wallet);
  const proof = tree.getHexProof(leafFor(cs));
  return proof as `0x${string}`[];
}

export function isInList(addresses: string[], wallet: string): boolean {
  if (!addresses || !wallet) return false;
  const target = wallet.toLowerCase();
  return addresses.some((a) => a.toLowerCase() === target);
}

export interface AllowlistData {
  team: string[];
  gtd: string[];
  fcfs: string[];
}

export async function uploadAllowlistToIPFS(data: AllowlistData, jwt: string): Promise<string> {
  const body = {
    pinataContent: data,
    pinataMetadata: { name: `hoodsea-allowlist-${Date.now()}` },
  };
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`IPFS upload failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json.IpfsHash as string;
}

export async function fetchAllowlistFromIPFS(cid: string): Promise<AllowlistData> {
  if (!cid) return { team: [], gtd: [], fcfs: [] };
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://nftstorage.link/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
  ];
  for (const url of gateways) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        return { team: json.team || [], gtd: json.gtd || [], fcfs: json.fcfs || [] };
      }
    } catch {}
  }
  return { team: [], gtd: [], fcfs: [] };
}

export { ZERO_ROOT };
