import { NEWS_ITEMS } from "@/lib/landing-content";

export const metadata = { title: "Field Notes | Hoodsea" };

export default function NewsPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-16">
      <p className="text-xs font-semibold text-[#00953F] uppercase tracking-widest mb-3">Field notes</p>
      <h1 className="text-4xl font-bold mb-4 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
        What sinks other launches
      </h1>
      <p className="text-gray-500 mb-12">
        The ways NFT and token launches go under out there, and the exact
        mechanism that keeps each one from happening on Hoodsea.
      </p>

      <div className="space-y-6">
        {NEWS_ITEMS.map((n) => (
          <article key={n.slug} id={n.slug} className="border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 text-[10px] font-bold text-red-500 bg-red-50 rounded-full">{n.tag}</span>
                <span className="text-xs text-gray-400">{n.date}</span>
              </div>
              <h2 className="text-xl font-semibold mb-3 leading-snug">{n.title}</h2>
              <p className="text-sm text-gray-600 leading-relaxed">{n.caseSummary}</p>
            </div>
            <div className="px-6 py-5 bg-[#EBF8E4]/60 border-t border-[#00C805]/15">
              <p className="text-[11px] font-bold text-[#00953F] uppercase tracking-wide mb-1.5">
                How Hoodsea holds
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{n.prevention}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
