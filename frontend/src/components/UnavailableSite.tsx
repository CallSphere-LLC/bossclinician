import { Seo } from "@/components/Seo";

/** No auth providers, forms, automatic redirects, or API requests. */
export function UnavailableSite() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sand px-6 py-16 text-ink">
      <Seo title="Page unavailable | Boss Clinician" description="This address is no longer available." noindex httpStatus={410} />
      <section className="w-full max-w-lg rounded-2xl border border-ink/10 bg-white p-8 text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-ink-soft">Boss Clinician</p>
        <h1 className="mb-4 text-3xl font-semibold">This page is unavailable</h1>
        <p className="mb-6 text-ink-soft">This address is no longer available.</p>
        <a className="font-medium underline underline-offset-4" href="https://www.bossclinician.com/">Visit the Boss Clinician website</a>
      </section>
    </main>
  );
}
