import { useState } from "react";
import { Link } from "react-router";
import { Check, ChevronDown, LockKeyhole, Play, ShieldCheck } from "lucide-react";
import type { CourseDetailResponse } from "@/components/course/CoursePriceLabel";
import { salesButtons, type SalesOffer } from "@/components/course/salesPage";
import "./StarterSuiteSalesPage.css";

const imageRoot = "/images/starter-suite";
const workbookPages = ["lesson-1.png", "lesson-2.png", "lesson-3.png", "workbook-page-4.png", "workbook-page-5.png"];

const questions = [
  "Do you dream of having your own private practice but feel overwhelmed by where to start?",
  "Are you unsure how to transition from an employee mindset to thinking like a business owner?",
  "Do you worry about finding your first few clients without spending hours on social media?",
  "Are you struggling to confidently set your rates and pricing structure?",
  "Do you feel stuck in indecision and wish you had a simple, step-by-step roadmap?",
  "Are you ready to finally take action and start your private practice with clarity and confidence?",
];

const lessons = [
  { number: "01", title: "From Employee to Business Owner", body: "Overcome mindset blocks & shift into CEO mode!", image: "lesson-1.png" },
  { number: "02", title: "Choosing Your Niche & Business Model", body: "Gain clarity on your niche & structure your practice for success.", image: "lesson-2.png" },
  { number: "03", title: "First 3 Clients Blueprint", body: "Proven referral & visibility strategies to attract clients (without relying solely on social media!)", image: "lesson-3.png" },
];

const testimonials = [
  { quote: "This course gave me the clarity, tools, and confidence I desperately needed. From setting up my business legally to attracting my first clients—every step was broken down in a way that finally made sense. I’m now seeing clients in my own practice and feel more in control of my future than ever before!", name: "Sharon S, LPC", practice: "Stillwaters Counseling", image: "testimonial-sharon.png" },
  { quote: "I had the passion and the license, but the business side of private practice felt overwhelming. The Starter Suite changed everything. Yvette laid it all out—step-by-step, no fluff. I finally understood what I needed to do to build a solid foundation and actually launch. Within weeks, I had my practice name, niche, and systems in place. I’m no longer just dreaming about private practice—I’m living it!", name: "Kristan L, LCSW", practice: "Intentional Focus Health and Wellness", image: "testimonial-kristan.png" },
  { quote: "I kept second-guessing myself—worried I’d miss a step or mess something up. The Starter Suite took away all that anxiety. It gave me the structure and support I didn’t even realize I needed. Yvette makes it feel possible, even when it feels scary. Now I have my EIN, my niche is clear, and I’m onboarding my first private clients. This was the push I needed to finally get started!", name: "Deanna H, LCSW", practice: "DH Counseling", image: "testimonial-deanna.png" },
];

const faqs = [
  { question: "Who is this course for?", answer: "This mini-course is designed for licensed therapists who want to start a private practice but feel overwhelmed. If you need a clear, step-by-step plan—this is for you!" },
  { question: "I’m already in private practice—will this still help me?", answer: "If you feel stuck with marketing, client attraction, or pricing, this course provides clarity on foundational business steps." },
  { question: "How long does it take to complete?", answer: "Each core lesson is under 30 minutes. Go through the course at your own pace and start implementing right away." },
  { question: "How do I access the course?", answer: "After purchase, you’ll have access in your Boss Clinician library. Go through the lessons at your own pace, on your own schedule." },
  { question: "What if I need more support after taking the mini-course?", answer: "Inside my Profitable Private Practice Leap Academy Membership, I provide in-depth training, ongoing coaching, and resources to help you grow your practice beyond the first steps. You’ll get a complete marketing system, pricing strategies, and client attraction frameworks—so you never feel lost in your business." },
];

function Action({ course, children, secondary = false }: { course: CourseDetailResponse; children: React.ReactNode; secondary?: boolean }) {
  const button = salesButtons(course.offers as SalesOffer[])[0];
  const to = course.owned ? "/library" : button?.to;
  if (!to) return <p className="text-sm text-[#273f4d]">Enrollment is unavailable right now.</p>;
  return (
    <Link to={to} className={secondary
      ? "inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-[#172e3c] bg-white px-6 py-3 text-center text-sm font-bold uppercase tracking-wide text-[#172e3c] transition hover:bg-[#e9e5f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172e3c]"
      : "inline-flex min-h-12 items-center justify-center rounded-lg bg-[#33cb0e] px-6 py-3 text-center text-sm font-extrabold uppercase tracking-wide text-[#142d37] shadow-[0_5px_0_#229307] transition hover:bg-[#40e11a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#172e3c]"}>
      {course.owned ? "Open My Starter Suite" : children}
    </Link>
  );
}

function Video({ id, poster, title }: { id: string; poster: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border border-[#213646]/20 bg-[#172e3c] shadow-xl">
      {playing ? (
        <iframe title={title} src={"https://fast.wistia.net/embed/iframe/" + id + "?autoPlay=true"} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="absolute inset-0 size-full" />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 size-full" aria-label={"Play " + title}>
          <img src={poster} alt="" className="size-full object-contain" />
          <span className="absolute inset-0 bg-black/15 transition group-hover:bg-black/25" />
          <span className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-[#172e3c]/90 text-white shadow-lg"><Play className="ml-1 size-9 fill-current" aria-hidden="true" /></span>
        </button>
      )}
    </div>
  );
}

function WorkbookMarquee() {
  return (
    <section className="overflow-hidden bg-[#e8e4f5] py-12" aria-label="A preview of the Starter Suite workbook">
      <h2 className="px-5 text-center font-display text-2xl font-bold sm:text-3xl">A look inside your workbook</h2>
      <div className="starter-book-viewport mt-8" tabIndex={0} aria-label="Scrolling workbook preview; pause by hovering or focusing">
        <div className="starter-book-track">
          {[0, 1].map(copy => (
            <div key={copy} className="starter-book-group" aria-hidden={copy === 1}>
              {workbookPages.map((page, index) => (
                <img key={page} src={imageRoot + "/" + page} alt={copy === 0 ? "Starter Suite workbook preview page " + (index + 1) : ""} loading="lazy" width="1112" height="1440" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StartMarquee({ course }: { course: CourseDetailResponse }) {
  const button = salesButtons(course.offers as SalesOffer[])[0];
  const to = course.owned ? "/library" : button?.to;
  if (!to) return null;
  return (
    <Link to={to} className="starter-words-viewport block overflow-hidden bg-[#172e3c] py-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6d5b8b]" aria-label="Start today with clarity and confidence">
      <span className="starter-words-track" aria-hidden="true">
        {[0, 1].map(copy => (
          <span key={copy} className="starter-words-group">
            {[0, 1, 2].map(part => (
              <span key={part} className="contents"><span>Start Today With Clarity &amp; Confidence</span><span className="text-[#c7bcea]">✦</span><span>SUBSCRIBE TODAY</span><span className="text-[#c7bcea]">✦</span></span>
            ))}
          </span>
        ))}
      </span>
    </Link>
  );
}

export default function StarterSuiteSalesPage({ course }: { course: CourseDetailResponse }) {
  const price = salesButtons(course.offers as SalesOffer[])[0]?.label.match(/\$[\d,.]+/)?.[0] ?? course.priceText ?? "";
  return (
    <main className="bg-[#f9f8fc] text-[#172e3c]">
      <div className="bg-[#cec7ea] px-4 py-3 text-center font-display text-sm font-semibold uppercase tracking-wide sm:text-lg">Therapists ready to start a private practice</div>

      <section className="relative overflow-hidden bg-gradient-to-b from-white via-white to-[#f1eef8] px-5 py-12 sm:py-20">
        <div className="mx-auto max-w-6xl text-center">
          <Link to="/courses" className="text-xs font-bold uppercase tracking-[0.18em] text-[#6d5b8b] underline-offset-4 hover:underline">← Browse all courses</Link>
          <p className="mt-8 text-sm font-bold uppercase tracking-[0.16em] text-[#6d5b8b]">Therapist to Boss Clinician</p>
          <h1 className="mx-auto mt-5 max-w-4xl font-display text-4xl font-bold leading-tight text-[#172e3c] sm:text-5xl">Here’s how therapists use these <span className="text-[#75628f]">3 steps</span> to launch their private practice & get paying clients</h1>
          <p className="mt-5 text-lg font-semibold italic">…without losing their income or risking their license.</p>
          <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.75fr)] lg:items-start">
            <Video id="3mmz1sj272" poster={imageRoot + "/intro-poster.jpg"} title="Private Practice Starter Suite introduction" />
            <div className="rounded-xl border border-[#7d7394]/40 bg-[#f0edf9] p-6 shadow-lg">
              <p className="text-xl font-extrabold uppercase">Available for instant digital access</p>
              <img src={imageRoot + "/course-mockup.png"} alt="Private Practice Starter Suite workbook and course mockup" className="mx-auto mt-5 w-full max-w-xs" />
              {price && <p className="mt-4 text-3xl font-black">{price} today</p>}
              <p className="mt-4 font-medium">Download the workbook and watch the training to start your practice on the right track.</p>
              <div className="mt-6"><Action course={course}>Get instant access {price && "for " + price}</Action></div>
              <p className="mt-5 flex items-center justify-center gap-2 text-xs font-medium"><ShieldCheck className="size-4" aria-hidden="true" /> Secure checkout</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#cec7ea] px-5 py-16 sm:py-24" aria-labelledby="starter-checklist">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#172e3c]/20 bg-[#f3f0fb] p-6 shadow-xl sm:p-12">
          <h2 id="starter-checklist" className="text-center font-display text-3xl font-bold">Check all of the questions where your answer is yes!</h2>
          <p className="mt-3 text-center text-sm">This is a quick self-check for you. Your answers stay on this page.</p>
          <div className="mx-auto mt-9 max-w-2xl space-y-3">
            {questions.map((question) => (
              <label key={question} className="flex cursor-pointer items-start gap-4 rounded-lg border border-[#b4abc9] bg-white p-4 text-base font-semibold leading-snug transition hover:bg-[#f6f3fc] has-[:checked]:border-[#61517f] has-[:checked]:bg-[#e7e0f5]">
                <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-[#61517f]" />
                <span>{question}</span>
              </label>
            ))}
          </div>
          <h3 className="mt-12 text-center font-display text-2xl font-bold">If you checked any of the boxes above,</h3>
          <p className="mx-auto mt-3 max-w-2xl text-center text-lg">it’s time to take the first step toward building your dream private practice—without the stress and uncertainty.</p>
          <p className="mx-auto mt-5 max-w-2xl text-center text-lg font-semibold">Meet the Private Practice Starter Suite, a step-by-step system to gain clarity, attract clients, and confidently step into business ownership.</p>
          <div className="mt-8 text-center"><Action course={course}>Let’s make this happen {price && "— " + price}</Action></div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-bold sm:text-4xl">Here’s a few of our case studies</h2>
          <p className="mt-2 text-center text-lg">Using the Therapist to Boss Clinician Method</p>
          <div className="mx-auto mt-8 max-w-3xl"><Video id="vy92lsus9y" poster={imageRoot + "/case-study-poster.jpg"} title="Therapist to Boss Clinician case studies" /></div>
          <div className="mt-10 text-center"><Action course={course} secondary>I’m ready to take action</Action></div>
        </div>
      </section>

      <section className="bg-[#e8e4f5] px-5 py-16 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2">
          <div><h2 className="font-display text-3xl font-bold">Can you relate?</h2><ul className="mt-6 space-y-4">{["You feel overwhelmed by the business side of private practice.", "You’re stuck in an employee mindset and unsure how to shift into a business owner mindset.", "You don’t know how to find clients without spending hours on social media.", "You’re worried about setting your prices too high—or too low."].map(x => <li key={x} className="flex gap-3"><Check className="mt-1 size-5 shrink-0 text-[#695987]" aria-hidden="true" />{x}</li>)}</ul></div>
          <div><h2 className="font-display text-3xl font-bold">Imagine this:</h2><ul className="mt-6 space-y-4">{["Having a clear, step-by-step plan to start your practice confidently.", "Knowing how to attract clients without chasing them online.", "Feeling empowered and in control of your private practice journey."].map(x => <li key={x} className="flex gap-3"><Check className="mt-1 size-5 shrink-0 text-[#695987]" aria-hidden="true" />{x}</li>)}</ul></div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 text-center sm:py-24">
        <div className="mx-auto max-w-5xl"><p className="font-display text-2xl">Introducing:</p><h2 className="mt-2 font-display text-4xl font-bold text-[#695987] sm:text-5xl">Private Practice Starter Suite</h2><p className="mx-auto mt-5 max-w-3xl text-xl">An affordable, action-packed mini-course to move from feeling stuck toward your first paying client without social media overwhelm.</p><div className="mt-8"><Action course={course}>Start your private practice today</Action></div></div>
      </section>

      <WorkbookMarquee />

      <section className="bg-[#f1eef9] px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl"><p className="mb-4 text-center font-display text-2xl font-bold">Why Private Practice Starter Suite Works So Well:</p><h2 className="text-center font-display text-3xl font-bold sm:text-4xl">3 power-packed video lessons</h2><p className="mt-3 text-center">Short, easily digestible, and actionable!</p><div className="mt-10 grid gap-6 md:grid-cols-3">{lessons.map(lesson => <article key={lesson.number} className="rounded-xl bg-white px-6 py-10 text-center"><h3 className="font-display text-2xl font-bold uppercase text-[#73628a] underline underline-offset-4">Video lesson {Number(lesson.number)}:</h3><p className="mt-5 text-lg font-bold">{lesson.title}</p><p className="mt-3 text-base italic leading-relaxed">{lesson.body}</p></article>)}</div><div className="mt-10 text-center"><Action course={course}>Get instant access</Action></div></div>
      </section>

      <section className="bg-white px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-5xl"><h2 className="text-center font-display text-3xl font-bold sm:text-4xl">Action-oriented resources</h2><p className="mt-3 text-center">Open the materials alongside the video lessons and put each step to work.</p><div className="mt-10 grid gap-5 sm:grid-cols-3">{["Mindset Shift Worksheet: Eliminate fear & step into confidence", "Niche Clarity & Business Model Worksheet: Define your ideal clients & pricing", "Client Attraction Quick-Start Checklist: Take action immediately with clear steps"].map(item => <div key={item} className="flex items-start gap-3 rounded-xl border border-[#c6bede] bg-[#f8f6fc] p-5 font-semibold"><Check className="size-5 shrink-0 text-[#695987]" aria-hidden="true" />{item}</div>)}</div><h3 className="mt-12 text-center font-display text-2xl font-bold">Bonuses to fast-track your progress</h3><div className="mt-6 grid gap-5 sm:grid-cols-2">{["Private Practice Starter Checklist: A complete step-by-step roadmap to launch", "From Employee to CEO Mindset Affirmations: Shift fear & imposter syndrome into confidence"].map(item => <div key={item} className="flex items-start gap-3 rounded-xl border border-[#c6bede] bg-[#f8f6fc] p-5 font-semibold"><Check className="size-5 shrink-0 text-[#695987]" aria-hidden="true" />{item}</div>)}</div></div>
      </section>

      <section className="bg-[#e8e4f5] px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl"><h2 className="text-center font-display text-3xl font-bold sm:text-4xl">What students are saying</h2><div className="mt-10 grid gap-6 lg:grid-cols-3">{testimonials.map(t => <blockquote key={t.name} className="flex flex-col rounded-xl bg-white p-6 shadow-md"><img src={imageRoot + "/" + t.image} alt={t.name + " testimonial photo"} loading="lazy" className="mx-auto mb-6 aspect-square w-full max-w-[16rem] object-contain" /><p className="flex-1 leading-relaxed">“{t.quote}”</p><footer className="mt-5 border-t border-[#d7d0e5] pt-4"><strong>{t.name}</strong><span className="block text-sm text-[#685d75]">{t.practice}</span></footer></blockquote>)}</div></div>
      </section>

      <section className="bg-white px-5 py-16 sm:py-24">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[15rem_1fr]"><img src={imageRoot + "/yvette.jpg"} alt="Yvette Howard" loading="lazy" className="mx-auto w-full max-w-[15rem] rounded-xl" /><div><h2 className="font-display text-3xl font-bold">Meet Yvette Howard</h2><p className="mt-5">Hey future Boss Clinician, I’m Yvette, a Licensed Clinical Social Worker, Boss Clinician, and business coach who specializes in helping therapists build profitable private practices.</p><p className="mt-4">I started my journey in 2018 with no roadmap and no idea where to begin. After navigating legal structures, billing, and a growing family, I built my own group practice and transitioned it into an employee-based agency in 2021.</p><p className="mt-4">Now I help therapists take the guesswork out of launching a practice so they can focus on their clients and the life they want to build.</p><p className="mt-4">With over 8 years of experience in mental health and 4 years as a business coach, I’m here to show you that creating a successful private practice is possible with the right foundation and mindset.</p></div></div>
      </section>

      <StartMarquee course={course} />

      <section className="bg-[#cec7ea] px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-center shadow-xl sm:p-10"><h2 className="font-display text-3xl font-bold">Here’s everything you get</h2><ul className="mt-7 space-y-3 text-left">{["3-step Private Practice Starter Suite video course", "Private Practice Starter Suite workbook", "Mindset Shift Worksheet", "Niche Clarity & Business Model Worksheet", "Client Attraction Quick-Start Checklist", "Private Practice Starter Checklist", "From Employee to CEO Mindset Affirmations"].map(item => <li key={item} className="flex gap-3 border-b border-[#e8e4f5] pb-3"><Check className="size-5 shrink-0 text-[#695987]" aria-hidden="true" />{item}</li>)}</ul>{price && <p className="mt-8 text-3xl font-black">Get access for {price}</p>}<p className="mt-3">Start building your private practice with clarity and confidence.</p><div className="mt-6"><Action course={course}>I’m ready to learn from Yvette</Action></div><p className="mt-5 flex items-center justify-center gap-2 text-xs"><LockKeyhole className="size-4" aria-hidden="true" /> Secure checkout and access in your library</p></div>
      </section>

      <section className="bg-white px-5 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl"><h2 className="text-center font-display text-3xl font-bold sm:text-4xl">Frequently asked questions</h2><div className="mt-9 divide-y divide-[#cbc2dc] border-y border-[#cbc2dc]">{faqs.map(faq => <details key={faq.question} className="group py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">{faq.question}<ChevronDown className="size-5 shrink-0 transition group-open:rotate-180" aria-hidden="true" /></summary><p className="pt-3 leading-relaxed text-[#354a56]">{faq.answer}</p></details>)}</div><div className="mt-10 text-center"><Action course={course}>Get started today</Action></div></div>
      </section>

      <section className="bg-[#f0edf9] px-5 py-10"><div className="mx-auto max-w-5xl text-xs leading-relaxed text-[#485765]"><p><strong>Disclaimer:</strong> The Private Practice Starter Suite provides guidance for starting a private practice. Case studies, examples, and testimonials are informational and do not guarantee similar results. Outcomes vary with personal effort, market conditions, and other factors. Income examples are illustrative, not typical or guaranteed.</p><p className="mt-3">Any business endeavor carries risk, and your results depend on your own circumstances and actions.</p></div></section>
    </main>
  );
}
