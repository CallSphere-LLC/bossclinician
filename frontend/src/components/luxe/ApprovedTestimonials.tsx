import { Section, SectionTitle } from "@/components/luxe/Section";

const reviews = {
  joanne: {
    name: "Joanne Tran",
    situation: "Joanne was taking the leap to start her private practice and wanted practical guidance as she navigated the business side of building it.",
    value: "Yvette’s lived experience, practical insight, guidance, perspective, and the clarity and confidence she gained while building.",
    quote: "Yvette has been such a vital part of my journey in taking the leap to start my private practice.",
    image: "/images/testimonials/joanne-approved-v1.png",
  },
  rosa: {
    name: "Rosa Montez",
    situation: "Rosa wanted to understand what it would take to expand from solo practice into a group practice and needed a space to think through the decision honestly.",
    value: "Yvette listened to her goals and concerns, answered her questions, shared knowledge, experience, resources, and practical suggestions, and helped her think through the next stage with more confidence.",
    quote: "By the end of our conversation, I felt less fearful and felt that I could move forward with my goals.",
    image: "/images/testimonials/rosa-approved-v1.png",
  },
  jenna: {
    name: "Jenna",
    situation: "Jenna wanted a clearer plan for the next stage of her business.",
    value: "Jenna valued Yvette’s direct feedback and left feeling prepared to take her next step.",
    quote: "I feel extremely prepared for the next step of growth in my business!",
    image: "/images/testimonials/jenna-approved-v1.png",
  },
} as const;

function Review({ review }: { review: (typeof reviews)[keyof typeof reviews] }) {
  return (
    <article className="min-w-0 rounded-2xl border border-current/15 p-6 sm:p-8">
      <h3 className="text-xl font-semibold">{review.name}</h3>
      <blockquote className="my-5 text-xl leading-relaxed">“{review.quote}”</blockquote>
      <p className="mb-4 leading-relaxed">{review.situation}</p>
      <p className="leading-relaxed">{review.value}</p>
      {review.image && (
        <details className="mt-6">
          <summary className="cursor-pointer underline underline-offset-4">Read {review.name}’s full review</summary>
          <a href={review.image} target="_blank" rel="noopener noreferrer" aria-label={`Open ${review.name}’s full review image in a new tab`}>
            <img src={review.image} alt={`${review.name}’s original approved review`} loading="lazy" decoding="async" className="mx-auto mt-4 h-auto w-full max-w-2xl rounded-lg" />
          </a>
        </details>
      )}
    </article>
  );
}

/** Approved excerpts from Yvette's row 234 brief. No client outcomes are inferred. */
export function ApprovedTestimonials({ program }: { program: "club" | "boardroom" }) {
  if (program === "boardroom") {
    return (
      <section className="br-section" aria-label="Working with Yvette">
        <div className="br-section-heading"><h2>Working with Yvette</h2></div>
        <div className="grid gap-6 md:grid-cols-2"><Review review={reviews.rosa} /><Review review={reviews.jenna} /></div>
      </section>
    );
  }
  return (
    <Section aria-label="Working with Yvette" surface="raised">
      <SectionTitle title="Working with Yvette" />
      <div className="mx-auto mt-8 max-w-3xl"><Review review={reviews.joanne} /></div>
    </Section>
  );
}
