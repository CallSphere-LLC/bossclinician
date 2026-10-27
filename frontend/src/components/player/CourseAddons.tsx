import type { CourseAddon } from "@/lib/libraryApi";

/** Plain links open checkout for a separate, optional purchase. No purchase API calls. */
export function CourseAddons({ items = [] }: { items?: CourseAddon[] }) {
  if (!items.length) return null;
  return <section aria-label="Optional add-ons" className="mt-8 border-t border-orchid/15 pt-6">
    <h2 className="font-display text-xl text-orchid">Optional add-ons</h2>
    <p className="mt-2 text-sm text-orchid-dim">Explore additional resources and support. These are separate purchases; your course access stays the same.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {items.map(item => <article key={item.offerId} className="flex min-w-0 flex-col rounded-xl border border-orchid/15 p-5">
        <h3 className="break-words font-semibold text-orchid">{item.title}</h3>
        {item.description && <p className="mt-2 break-words text-sm text-orchid-dim">{item.description}</p>}
        {item.available && item.href?.startsWith('/checkout/')
          ? <a href={item.href} className="mt-auto inline-flex pt-4 min-h-11 items-center font-semibold text-luxe-gold underline underline-offset-4">View purchase options<span className="sr-only"> for {item.title}</span></a>
          : <p className="mt-4 text-sm text-orchid-dim">Currently unavailable</p>}
      </article>)}
    </div>
  </section>;
}
