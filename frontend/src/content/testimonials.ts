import type { Testimonial } from "@/types";

export const testimonials: Testimonial[] = [
  // The first three are the home page's featured trio (green / plum / gold).
  // `photo` is intentionally unset until Yvette supplies real headshots — the
  // cards render an initial-letter placeholder in the accent colour instead.
  {
    id: "t-kristan",
    name: "Kristan L.",
    credential: "LCSW",
    practice: "Intentional Focus Health and Wellness",
    quote:
      "With Yvette's support and guidance I was able to shift into my journey in private practice. She kept me accountable with clear, realistic goals and provided exactly the resources I needed at every stage.",
    image: "/images/f48662c2e2cf.png",
    sort: 1,
    published: true,
  },
  {
    id: "t-sharon",
    name: "Sharon S.",
    credential: "LPC",
    practice: "Stilwaters Counseling",
    quote:
      "Yvette is knowledgeable about the ins and outs of the counseling business. With her guidance I'm now 100% in control of my business, and I finally feel like the CEO I always knew I could be.",
    image: "/images/a9f02fa658eb.png",
    sort: 2,
    published: true,
  },
  {
    id: "t-rosa",
    name: "Rosa M.",
    credential: "LCSW",
    practice: "Follow Your Path Therapy Services",
    quote:
      "I had a business coaching session with Yvette when I was trying to figure out how to grow into a group practice. From the very beginning, she took the time to truly listen and understand exactly where I was trying to go. She answered all of my questions thoughtfully and offered valuable suggestions that gave me a completely new perspective on what building a group practice could actually look like. I felt completely comfortable being honest about my concerns, and Yvette met me exactly where I was. By the end of our conversation, I felt less fearful and confident enough to move forward. Yvette has a real ability to empower and encourage, and I'm so grateful for her guidance on this journey.",
    image: "",
    sort: 3,
    published: true,
  },
  {
    id: "t-deanna",
    name: "Deanna H.",
    credential: "LCSW",
    quote:
      "Yvette helped empower me to start my own practice and has provided insightful support along the way. Her genuine spirit is so appreciated!",
    image: "/images/5227d6258979.png",
    sort: 4,
    published: true,
  },
  {
    id: "t-michael",
    name: "Michael M.",
    credential: "LPC",
    quote:
      "Yvette provided resources for my internal dilemmas, support with video playbacks, and accountability — every step of the way she showed up fully for me.",
    image: "/images/11671818228c.jpeg",
    sort: 5,
    published: true,
  },
  {
    id: "t-saritha",
    name: "Saritha F.",
    credential: "LCSW",
    quote:
      "I went from doing everything on my own and feeling overwhelmed… to hiring clinicians, implementing systems, and leading a practice that actually feels sustainable.",
    image: "/images/2b6796d95501.jpeg",
    sort: 6,
    published: true,
  },
  {
    id: "t-ashley",
    name: "Ashley B.",
    credential: "LCSW",
    quote:
      "Yvette is the mentor every therapist needs. She's built exactly what I'm trying to create, and her experience showed me how to avoid the mistakes most of us make alone. Investing in her was an easy yes.",
    image: "/images/e342b1098928.jpeg",
    sort: 7,
    published: true,
  },
];
