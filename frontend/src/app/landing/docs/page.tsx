import { DOC_SECTIONS } from "@/lib/landing-content";

export const metadata = { title: "Docs | Hoodsea" };

export default function DocsPage() {
  return (
    <div className="max-w-6xl mx-auto px-5 py-16 flex gap-12">
      {/* Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-24">
          <p className="text-xs font-semibold text-[#00953F] uppercase tracking-widest mb-4">Documentation</p>
          <nav className="space-y-1">
            {DOC_SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}
                className="block px-3 py-2 text-sm text-gray-500 rounded-lg hover:bg-[#EBF8E4] hover:text-[#00953F] transition-colors">
                {s.title}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 max-w-3xl">
        <h1 className="text-4xl font-bold mb-4 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          Docs
        </h1>
        <p className="text-gray-500 mb-12">
          How the deep works, end to end: launching a drop, minting, bonding and trading on Hoodsea.
        </p>

        <div className="space-y-12">
          {DOC_SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="text-2xl font-semibold mb-4">{s.title}</h2>
              {s.paragraphs.map((p, i) => (
                <p key={i} className="text-[15px] text-gray-600 leading-relaxed mb-3">{p}</p>
              ))}
              {s.bullets && (
                <ul className="mt-3 space-y-2">
                  {s.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2.5 text-[15px] text-gray-600 leading-relaxed">
                      <span className="text-[#00C805] mt-0.5">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
