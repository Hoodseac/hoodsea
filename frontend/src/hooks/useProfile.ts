"use client";
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

export interface UserProfile {
  address: string;
  username: string;
  twitter: string | null;
  twitterVerified?: boolean;
  twitterId?: string | null;
  avatar: string | null;
  website: string | null;
  bio: string | null;
  createdAt: number;
  updatedAt: number;
}

export function useProfile() {
  const { address } = useAccount();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setNeedsSetup(false);
      return;
    }
    setLoading(true);
    fetch(`${API}/api/profile/${address}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setProfile(null);
          setNeedsSetup(true);
        } else {
          setProfile(data);
          setNeedsSetup(false);
        }
      })
      .catch(() => setNeedsSetup(true))
      .finally(() => setLoading(false));
  }, [address]);

  const updateProfile = (p: UserProfile) => {
    setProfile(p);
    setNeedsSetup(false);
  };

  return { profile, loading, needsSetup, updateProfile, API };
}
