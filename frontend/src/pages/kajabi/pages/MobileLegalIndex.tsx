import type { LegalClause } from "@/content/kajabiPagesLegal";

/** Narrow-screen section index for the Terms and CEU policies. */
export function MobileLegalIndex({
  clauses,
  label,
}: {
  clauses: readonly LegalClause[];
  label: string;
}) {
  const sections = clauses.filter((clause) => clause.heading);
  return (
    <nav aria-label={`${label} sections`} className="order-2 mx-auto w-full max-w-[62rem] px-5 py-7 xl:hidden">
      <details className="rounded-xl border border-gold/25 bg-white/[0.04] p-4">
        <summary className="cursor-pointer rounded-md px-1 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
          On this page
        </summary>
        <ul className="mt-3 border-t border-white/10 pt-3">
          {sections.map((clause) => (
            <li key={clause.id}>
              <a
                href={`#${clause.id}`}
                className="block min-h-[44px] rounded-md px-2 py-3 text-sm leading-snug text-orchid-dim hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {clause.heading}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
