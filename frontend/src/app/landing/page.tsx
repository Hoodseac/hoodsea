import Link from "next/link";
import { NEWS_ITEMS } from "@/lib/landing-content";
import { RevealText } from "@/components/landing/RevealText";
import { FadeInUp, MountUp, CandleChart } from "@/components/landing/LandingExtras";
import { HeroBackdrop, HeroWaveScene, WaveLine, WaveMark, type MarkVariant } from "@/components/landing/HoodseaWaves";

const APP_URL = `${(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "")}/explore`;

// The four beats of a Hoodsea drop. Flavor titles up top, but the sub-text keeps
// every step crystal clear. The plain verb stays in the kicker so nothing is lost.
const STEPS = [
  {
    n: "01",
    kicker: "LAUNCH",
    title: "Drop it",
    text: "Upload 3 to 6 photos, set your price and phases. A collection of 10 to 10,000 NFTs, your call on the size, goes live for the cost of gas.",
  },
  {
    n: "02",
    kicker: "MINT",
    title: "Let it fill",
    text: "Allowlists mint first, TEAM then GTD then FCFS, enforced on-chain with merkle proofs and per-wallet caps. Then the public takes the rest.",
  },
  {
    n: "03",
    kicker: "BOND",
    title: "It surfaces",
    text: "The mint that sells the collection out triggers bonding: rarities shuffle on a seed no bot can see coming, and an ERC-20 token deploys on its own.",
  },
  {
    n: "04",
    kicker: "TRADE",
    title: "Ride the current",
    text: "Liquidity seeds and locks on Uniswap V3 (1%) and V4, for good. Trade in-app, and the vault begins its burn and airdrop schedule.",
  },
];

// One featured guarantee, then three supporting ones. Asymmetric on purpose.
const FEATURE: { mark: MarkVariant; title: string; text: string } = {
  mark: "tide",
  title: "The liquidity can't move",
  text: "When a collection mints out, the contract opens Uniswap V3 (1%) and V4 pools and locks the liquidity with no withdrawal path. Not the creator, not the platform, not anyone. It stays down there for good, and every line of it is readable on-chain.",
};

const PILLARS: { mark: MarkVariant; title: string; text: string }[] = [
  { mark: "bubbles", title: "Nothing to snipe", text: "Rarities don't exist until sellout. The whole 46/30/15/5/1/3 spread shuffles in one transaction on a seed no bot can predict. Every mint has the same odds." },
  { mark: "crest", title: "A vault on a timer", text: "Half of every token locks in the vault. On days 1, 7, 14, 28 and 56 it burns 9% of supply and drops 1% on 100 random holders. Hard-coded, unskippable." },
  { mark: "drop", title: "No approval to drain", text: "The marketplace lives inside the NFT contract. There is no external operator to approve, so the classic approval drain has nothing to grab." },
];

const SIGNALS = ["Free to mint", "Liquidity locked for good", "Airdrops every epoch"];

export default function LandingPage() {
  const latest = NEWS_ITEMS.slice(0, 3);
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative max-w-6xl mx-auto px-5 pt-16 pb-12 sm:pt-20 overflow-hidden">
        <HeroBackdrop />
        <div className="relative z-10 grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative z-10 text-center lg:text-left">
            <MountUp delay={0}>
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-semibold text-[#00953F] bg-white/70 border border-[#00C805]/25 rounded-full mb-6">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00C805] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00C805]" />
                </span>
                LIVE ON ROBINHOOD CHAIN
              </span>
            </MountUp>
            <h1 className="text-[2.6rem] leading-[1.05] sm:text-6xl font-bold tracking-tight mb-6" style={{ fontFamily: "var(--font-display)" }}>
              <RevealText text="Launch into the deep." />
              <br />
              <RevealText text="Surface with a token." className="text-[#00C805]" />
            </h1>
            <MountUp delay={0.12}>
              <p className="max-w-xl mx-auto lg:mx-0 text-base sm:text-lg text-gray-500 mb-8 leading-relaxed">
                Free-mint a collection. When it sells out it bonds, a token lists with liquidity
                locked for good, and the vault starts paying holders. The contract runs all of it.
                No one gets to pull the current.
              </p>
            </MountUp>
            <MountUp delay={0.2}>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3">
                <a href={APP_URL}
                  className="px-8 py-3.5 bg-[#CEF606] text-[#050600] text-sm font-semibold rounded-full hover:bg-[#DCFF2E] transition-colors shadow-md text-center">
                  Enter the deep
                </a>
                <Link href="/docs"
                  className="px-8 py-3.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-full hover:border-[#00C805]/40 hover:text-[#00953F] transition-colors text-center">
                  Read the docs
                </Link>
              </div>
            </MountUp>
            {/* Signal strip: three terse facts on a hairline rail */}
            <MountUp delay={0.28}>
              <div className="mt-9 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 border-t border-[#00C805]/12 pt-5">
                {SIGNALS.map((s) => (
                  <span key={s} className="inline-flex items-center gap-2 text-xs font-medium text-gray-500">
                    <span className="h-1 w-1 rounded-full bg-[#00C805]" />
                    {s}
                  </span>
                ))}
              </div>
            </MountUp>
          </div>
          <MountUp delay={0.1}>
            <HeroWaveScene />
          </MountUp>
        </div>
      </section>

      {/* ── The current (how it works) ───────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="mb-3" aria-hidden><WaveLine /></div>
        <p className="text-[11px] font-semibold text-[#00953F] uppercase tracking-[0.2em] text-center mb-3">The current</p>
        <h2 className="text-3xl sm:text-[2.2rem] font-bold text-center mb-12 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          <RevealText text="From photos to a live token, in one drop" />
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <FadeInUp key={s.n} index={i} className="h-full">
              <div className="relative h-full overflow-hidden rounded-2xl border border-white/60 bg-white/30 backdrop-blur-md p-6 transition-all hover:bg-white/45 hover:-translate-y-1">
                {/* top accent hairline */}
                <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#CEF606] to-[#00C805]/0" />
                {/* ghost numeral */}
                <span className="pointer-events-none absolute -right-1 -top-3 text-7xl font-bold leading-none text-[#00C805]/[0.07] select-none" style={{ fontFamily: "var(--font-display)" }}>{s.n}</span>
                <p className="relative text-[10px] font-bold tracking-[0.18em] text-[#00953F]">{s.n} · {s.kicker}</p>
                <h3 className="relative text-lg font-semibold mt-2 mb-2 tracking-tight">{s.title}</h3>
                <p className="relative text-sm text-gray-500 leading-relaxed">{s.text}</p>
              </div>
            </FadeInUp>
          ))}
        </div>
      </section>

      {/* ── Signature section: Locked in the deep ────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <p className="text-[11px] font-semibold text-[#00953F] uppercase tracking-[0.2em] text-center mb-3">Why it holds</p>
        <h2 className="text-3xl sm:text-[2.2rem] font-bold text-center mb-4 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          <RevealText text="Locked in the deep" />
        </h2>
        <p className="text-center text-sm text-gray-500 max-w-xl mx-auto mb-12">
          Every guarantee is enforced by the contract, not by a promise. Here is what that buys you.
        </p>

        {/* Featured guarantee: a wide lead panel */}
        <FadeInUp>
          <div className="relative overflow-hidden rounded-3xl border border-[#00C805]/20 bg-gradient-to-br from-[#E9F6DF]/80 to-white/40 backdrop-blur-md p-8 sm:p-10 mb-4">
            <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
              <WaveMark variant={FEATURE.mark}
                className="h-24 w-24 sm:h-28 sm:w-28 drop-shadow-[0_10px_22px_rgba(0,200,5,0.20)]" />
              <div>
                <h3 className="text-2xl font-bold mb-2 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>{FEATURE.title}</h3>
                <p className="text-[15px] text-gray-600 leading-relaxed max-w-2xl">{FEATURE.text}</p>
              </div>
            </div>
          </div>
        </FadeInUp>

        {/* Three supporting guarantees */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PILLARS.map((p, i) => (
            <FadeInUp key={p.title} index={i} className="h-full">
              <div className="h-full rounded-2xl border border-white/60 bg-white/30 backdrop-blur-md p-6 transition-colors hover:bg-white/45">
                <WaveMark variant={p.mark}
                  className="h-16 w-16 mb-3 drop-shadow-[0_10px_22px_rgba(0,200,5,0.18)]" />
                <h3 className="text-base font-semibold mb-2 tracking-tight">{p.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{p.text}</p>
              </div>
            </FadeInUp>
          ))}
        </div>
      </section>

      {/* ── Field notes (security feed preview) ──────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-[11px] font-semibold text-[#00953F] uppercase tracking-[0.2em] mb-3">Field notes</p>
            <h2 className="text-3xl sm:text-[2.2rem] font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              <RevealText text="What sinks other launches" />
            </h2>
          </div>
          <Link href="/news" className="hidden sm:block text-sm font-semibold text-[#00953F] hover:text-[#00C805] transition-colors whitespace-nowrap">
            All notes →
          </Link>
        </div>
        <FadeInUp className="mb-6"><CandleChart /></FadeInUp>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {latest.map((n, i) => (
            <FadeInUp key={n.slug} index={i} className="h-full">
              <Link href="/news"
                className="p-6 border border-white/60 rounded-2xl bg-white/30 backdrop-blur-md hover:bg-white/45 hover:-translate-y-0.5 transition-all block h-full">
                <span className="inline-block px-2.5 py-1 text-[10px] font-bold text-red-500 bg-red-50 rounded-full mb-3">{n.tag}</span>
                <h3 className="text-base font-semibold mb-2 leading-snug tracking-tight">{n.title}</h3>
                <p className="text-sm text-gray-500 line-clamp-3">{n.caseSummary}</p>
                <p className="text-xs font-semibold text-[#00953F] mt-4">How Hoodsea holds →</p>
              </Link>
            </FadeInUp>
          ))}
        </div>
        <Link href="/news" className="mt-6 block sm:hidden text-sm font-semibold text-[#00953F]">
          All notes →
        </Link>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-5 py-16 text-center">
        <FadeInUp>
          <div className="mb-6 flex justify-center" aria-hidden><WaveLine className="max-w-xs" /></div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            Come up bonded
          </h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">Drop a collection or trade one that already surfaced. Everything here is contract-enforced and readable on-chain.</p>
          <a href={APP_URL}
            className="inline-block px-10 py-4 bg-[#CEF606] text-[#050600] text-sm font-semibold rounded-full hover:bg-[#DCFF2E] transition-colors shadow-md">
            Enter the deep
          </a>
        </FadeInUp>
      </section>
    </div>
  );
}
