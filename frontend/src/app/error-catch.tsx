"use client";
import { useEffect } from "react";
export function ErrorCatch() {
  useEffect(() => {
    window.addEventListener("error", (e) => {
      document.title = "ERR: " + (e.message || "").slice(0, 80);
    });
    window.addEventListener("unhandledrejection", (e) => {
      document.title = "REJ: " + String(e.reason).slice(0, 80);
    });
  }, []);
  return null;
}
