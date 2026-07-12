"use client";

import { useState, useEffect, useRef } from "react";
import { useSignMessage } from "wagmi";
import { motion } from "framer-motion";
import { uploadToIPFS } from "@/lib/ipfs";
import { IpfsImage } from "./IpfsImage";
import { NftAvatarPicker } from "./NftAvatarPicker";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

interface Props {
  address: string;
  onComplete: (profile: any) => void;
  // Edit mode: reopen the modal to change profile after first setup.
  editMode?: boolean;
  initialUsername?: string;
  initialTwitter?: string;
  initialTwitterVerified?: boolean;
  initialAvatar?: string;
  initialWebsite?: string;
  initialBio?: string;
  onClose?: () => void;
}

export function ProfileSetupModal({
  address, onComplete, editMode = false,
  initialUsername = "", initialTwitter = "",
  initialAvatar = "", initialWebsite = "", initialBio = "",
  onClose,
}: Props) {
  const [username, setUsername] = useState(initialUsername);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [website, setWebsite] = useState(initialWebsite);
  const [bio, setBio] = useState(initialBio);
  const [avail, setAvail] = useState<"idle" | "checking" | "ok" | "taken">(editMode && initialUsername ? "ok" : "idle");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { signMessageAsync } = useSignMessage();

  // Debounced availability check
  useEffect(() => {
    if (username.length < 3) { setAvail("idle"); return; }
    // Keeping your own current username is always fine (don't flag it as taken)
    if (username.toLowerCase() === initialUsername.toLowerCase()) { setAvail("ok"); return; }
    setAvail("checking");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/profile/check/${username}`);
        const d = await r.json();
        setAvail(d.available ? "ok" : "taken");
      } catch { setAvail("idle"); }
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError("Image too large (max 5MB)"); return; }
    setUploading(true);
    setError("");
    try {
      // Server-side Irys upload (no wallet signature needed); Pinata fallback inside.
      const uri = await uploadToIPFS(f);
      setAvatar(uri);
    } catch {
      setError("Upload failed, try again");
    } finally {
      setUploading(false);
    }
  };

  const submit = async (skip = false) => {
    setLoading(true);
    setError("");
    try {
      const timestamp = Date.now();
      const msgUsername = skip ? "random" : username.toLowerCase().trim();
      const message = `Sign to set Hoodsea profile\nUsername: ${msgUsername}\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const r = await fetch(`${API}/api/profile/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          username: skip ? "" : username,
          twitter: skip ? "" : initialTwitter,
          avatar: skip ? "" : avatar,
          website: skip ? "" : website,
          bio: skip ? "" : bio,
          signature,
          timestamp,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      onComplete(data.profile);
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("rejected") || msg.includes("denied") || msg.includes("cancel")) {
        setError("Signature cancelled");
      } else {
        setError(msg || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = username.length >= 3 && avail === "ok";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      {/* Backdrop click closes whenever a close handler exists (edit OR anonymous skip) */}
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose || undefined} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close: edit mode, or first-time users who want to stay anonymous */}
        {onClose && (
          <button onClick={onClose} className="absolute right-4 top-4 text-text-dim hover:text-text-primary text-sm" aria-label="Close">×</button>
        )}

        {/* Header + avatar */}
        <div className="text-center mb-6">
          <div className="relative w-20 h-20 mx-auto mb-3">
            <div className="w-20 h-20 rounded-full gradient-bg flex items-center justify-center overflow-hidden">
              {avatar ? (
                <IpfsImage uri={avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-3xl font-bold">{(username[0] || "H").toUpperCase()}</span>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload photo"}
            </button>
            <span className="text-text-dim">·</span>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="text-xs font-semibold text-accent hover:underline"
            >
              {showPicker ? "Close" : "Use an NFT"}
            </button>
            {avatar && (
              <>
                <span className="text-text-dim">·</span>
                <button onClick={() => setAvatar("")} className="text-xs font-semibold text-text-dim hover:text-down">Remove</button>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
          {showPicker && (
            <div className="mb-4 p-3 border border-border rounded-xl bg-surface">
              <NftAvatarPicker owner={address} onPick={(img) => { setAvatar(img); setShowPicker(false); }} />
            </div>
          )}
          <h2 className="text-xl font-bold text-text-primary mb-1">
            {editMode ? "Edit profile" : "Set your profile"}
          </h2>
          <p className="text-sm text-text-secondary">
            {editMode ? "Update your details, connect your X, set a picture" : "Pick a unique name visible to everyone on Hoodsea"}
          </p>
        </div>

        <div className="mb-5 space-y-3">
          {/* Username */}
          <div>
            <div className="relative">
              <input
                className="input-base pr-24"
                placeholder="cosmic_ape"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 20))
                }
                maxLength={20}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium">
                {avail === "checking" && <span className="text-text-dim">checking...</span>}
                {avail === "ok" && <span className="text-accent">available</span>}
                {avail === "taken" && <span className="text-down">taken</span>}
              </div>
            </div>
            <p className="text-xs text-text-dim mt-1.5">3–20 chars · letters, numbers, underscores</p>
          </div>

          {/* Website */}
          <input
            className="input-base"
            placeholder="https://yourwebsite.xyz (optional)"
            value={website}
            onChange={(e) => setWebsite(e.target.value.slice(0, 200))}
            maxLength={200}
          />

          {/* Bio */}
          <textarea
            className="input-base resize-y"
            rows={3}
            placeholder="Short bio (optional)"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            maxLength={280}
          />

          {error && <p className="text-xs text-down">{error}</p>}
        </div>

        {/* Buttons */}
        <button
          onClick={() => submit(false)}
          disabled={loading || !canSubmit}
          className="btn-primary btn-block mb-3"
        >
          {loading ? "Signing..." : editMode ? "Save" : "Set Profile"}
        </button>

        {!editMode && (
          <button
            onClick={() => submit(true)}
            disabled={loading}
            className="w-full text-sm text-text-secondary hover:text-text-primary transition-colors py-2 disabled:opacity-40"
          >
            Skip, give me a random username
          </button>
        )}

        {!editMode && onClose && (
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full text-xs text-text-dim hover:text-text-secondary transition-colors py-1 disabled:opacity-40"
          >
            Continue without a username (stay anonymous)
          </button>
        )}

        <p className="text-center text-xs text-text-dim mt-3">Free · No gas · Sign once</p>
      </motion.div>
    </div>
  );
}
