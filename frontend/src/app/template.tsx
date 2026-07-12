"use client";

// Re-mounts on every route change, so each page gets a clean fade-in.
// Reduced-motion users get an instant render via the globals.css media query.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
