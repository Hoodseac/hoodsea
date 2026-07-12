import type { Config } from "tailwindcss";

// Hoodsea theme (Primehod / Robinhood look): light ivory paper, white cards
// with hairline borders, near-black ink text. Lime (#CEF606, token `sea`) is
// the signature and is used for BACKGROUNDS/buttons/progress/selection ONLY
// (never text) with ink on top. Green (brand #00C805 / accent #00953F) carries
// readable text, links and small accents. Red (#FF494A) marks sell/error.
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core palette
        ink: "#050600",
        paper: "#F4F7EC",
        line: "rgba(5, 6, 0, 0.08)",
        // sea = the lime signature. Backgrounds / buttons / progress / selection
        // ONLY (never text): always pair with ink text on top.
        sea: { DEFAULT: "#CEF606", bright: "#DCFF2E", dim: "#A8E600" },
        mint: "#EBF8E4",
        brand: "#00C805",
        accent: "#00953F",
        down: "#FF494A",
        // Legacy token names used across the app, remapped to the new palette
        void: "#050600",
        surface: "#F4F7EC",
        panel: "#ffffff",
        border: "rgba(5, 6, 0, 0.08)",
        muted: "#EAEEDD",
        danger: "#FF494A",
        // amber = the readable green accent (borders, focus rings, tints).
        amber: {
          DEFAULT: "#00C805",
          bright: "#2BE3AC",
          dim: "#00953F",
          glow: "#00C80533",
        },
        // Rarity (unchanged)
        common: "#6b7280",
        uncommon: "#22c55e",
        rare: "#3b82f6",
        epic: "#a855f7",
        legendary: "#f59e0b",
        mythic: "#ec4899",
        // Text: ink on paper
        text: {
          primary: "#050600",
          secondary: "#6B7280",
          dim: "#9CA3AF",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        body: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        glass: "0 1px 2px rgba(5,6,0,0.04), 0 12px 32px -20px rgba(5,6,0,0.1)",
        lift: "0 2px 4px rgba(5,6,0,0.04), 0 24px 44px -22px rgba(5,6,0,0.16)",
        panel: "0 1px 2px rgba(5,6,0,0.04)",
        card: "0 1px 2px rgba(5,6,0,0.04), 0 12px 32px -20px rgba(5,6,0,0.1)",
        "card-hover":
          "0 2px 4px rgba(5,6,0,0.04), 0 24px 44px -22px rgba(5,6,0,0.16)",
        btn: "0 1px 2px rgba(5,6,0,0.06), 0 10px 22px -12px rgba(150,190,0,0.55)",
        amber: "0 10px 22px -12px rgba(0,200,5,0.4)",
        "amber-lg": "0 16px 28px -12px rgba(0,200,5,0.45)",
        "inner-amber": "inset 0 0 30px rgba(0,200,5,0.05)",
      },
      maxWidth: {
        page: "1240px",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        float: "float 6s ease-in-out infinite",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
