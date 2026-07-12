"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import toast from "react-hot-toast";
import { CopyAddress } from "@/components/ui/CopyAddress";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

// Read a File as a base64 data URL so it can ride along in the JSON body.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function SupportPage() {
  const { address } = useAccount();
  const [message, setMessage] = useState("");
  const [telegram, setTelegram] = useState("");
  const [xUser, setXUser] = useState("");
  const [txHash, setTxHash] = useState("");
  const [wallet, setWallet] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > 5 * 1024 * 1024) {
      toast.error("Image too large (max 5MB)");
      return;
    }
    setPhoto(f);
  };

  const submit = async () => {
    const msg = message.trim();
    if (msg.length < 3) {
      toast.error("Please describe the issue");
      return;
    }
    const tg = telegram.trim();
    const xh = xUser.trim();
    if (!tg && !xh) {
      toast.error("Add a Telegram or X username so we can reply");
      return;
    }
    const tx = txHash.trim();
    if (tx && !/^0x[a-fA-F0-9]{64}$/.test(tx)) {
      toast.error("That tx hash looks invalid");
      return;
    }
    // Normalize a single contact string: "TG @handle / X @handle"
    const norm = (h: string) => (h.startsWith("@") ? h : "@" + h);
    const contact = [tg ? `TG ${norm(tg)}` : "", xh ? `X ${norm(xh)}` : ""].filter(Boolean).join(" / ");
    setSending(true);
    try {
      let photoData = "";
      if (photo) photoData = await fileToDataUrl(photo);
      const r = await fetch(`${API}/api/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          contact,
          txHash: tx,
          wallet: (wallet.trim() || address || ""),
          photo: photoData,
        }),
      });
      if (!r.ok) throw new Error();
      setSent(true);
      setMessage("");
      setTelegram("");
      setXUser("");
      setTxHash("");
      setWallet("");
      setPhoto(null);
      toast.success("Support request sent!");
    } catch {
      toast.error("Could not send, try again");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">Support</p>
      <h1 className="text-3xl font-bold text-text-primary mb-2" style={{ fontFamily: "var(--font-display)" }}>
        Get help
      </h1>
      <p className="text-sm text-text-secondary mb-8 leading-relaxed">
        Stuck on a transaction, mint, or anything else? Tell us what happened.
        Add the transaction hash and a screenshot if you have them, it helps us
        sort it out faster.
      </p>

      {sent ? (
        <div className="card text-center py-12">
          <p className="text-lg font-semibold text-text-primary mb-2">Request received</p>
          <p className="text-sm text-text-secondary mb-6">Our team will look into it. If you left a contact or wallet, we will reach back.</p>
          <button onClick={() => setSent(false)} className="btn-outline btn-sm">Send another</button>
        </div>
      ) : (
        <div className="card space-y-4">
          <div>
            <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">
              What's the problem
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={2000}
              placeholder="Describe what happened, on which page, and what you expected..."
              className="input-base resize-y"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">
              Contact <span className="text-accent">*</span> <span className="normal-case text-text-dim font-normal">(Telegram or X, at least one)</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center input-base gap-1.5 px-3">
                <span className="text-text-dim text-sm">TG</span>
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  maxLength={64}
                  placeholder="@username"
                  className="bg-transparent outline-none flex-1 text-sm min-w-0"
                />
              </div>
              <div className="flex items-center input-base gap-1.5 px-3">
                <span className="text-text-dim text-sm">X</span>
                <input
                  value={xUser}
                  onChange={(e) => setXUser(e.target.value)}
                  maxLength={64}
                  placeholder="@username"
                  className="bg-transparent outline-none flex-1 text-sm min-w-0"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">
              Transaction hash (optional)
            </label>
            <input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              maxLength={66}
              placeholder="0x..."
              className="input-base font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">
              Wallet (optional)
            </label>
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              maxLength={42}
              placeholder={address || "0x..."}
              className="input-base font-mono text-sm"
            />
            {address && !wallet.trim() && (
              <p className="text-[11px] text-text-dim mt-1.5 inline-flex items-center gap-1 flex-wrap">
                Connected wallet
                <CopyAddress address={address} iconSize={11} title="Copy wallet address" className="text-[11px] text-text-dim" />
                will be attached.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">
              Screenshot (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={onPickPhoto}
              className="block w-full text-sm text-text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber/10 file:text-accent hover:file:bg-amber/20"
            />
            {photo && (
              <p className="text-[11px] text-text-dim mt-1.5">{photo.name} attached</p>
            )}
          </div>

          <button onClick={submit} disabled={sending} className="btn-primary btn-block">
            {sending ? "Sending..." : "Send support request"}
          </button>
        </div>
      )}
    </div>
  );
}
