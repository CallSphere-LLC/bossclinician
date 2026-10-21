import { useState } from "react";
import { Link } from "react-router";
import { Check, Play } from "lucide-react";
import type { CourseDetailResponse } from "./CoursePriceLabel";
import { priceLabel } from "./CoursePriceLabel";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";

const root = "/images/fully-booked";
const benefits = [
  ["Position yourself as the go-to therapist for your ideal clients", "Attract a steady stream of high-quality clients by creating an irresistible online presence."],
  ["Lead consultation calls with confidence", "Convert potential clients effortlessly—without feeling pushy or salesy."],
  ["Implement a proven strategy to book more clients consistently", "Fill your calendar with clients who are ready to invest—without relying solely on word-of-mouth."],
  ["Avoid common mistakes that keep therapists stuck", "Break free from the cycle of inconsistent inquiries and build a thriving practice."],
];
const testimonials = [
  {name:"Sharon S. LPC",quote:"Yvette is truly a person who has a desire to guide, teach and mentor others into their profession. She is supportive, patient, and knowledgeable about the ins and outs of the counseling business. Yvette always encouraged me to have faith, confidence in my abilities. I'm now 100% in control of my business."},
  {name:"Kristan L. LCSW",quote:"Yvette is a pleasure to work with. She is professional and authentic. With her support and guidance I was able to shift into my journey in private practice. If you are looking to work with someone that knows what they are doing, and truly wants to see you succeed, reach out to Yvette!"},
  {name:"Deanna H. LCSW",quote:"Yvette helped empower me to start my own practice and has provided insightful support along the way. Her genuine spirit is so appreciated!"},
];

export default function FullyBookedSalesPage({course}:{course:CourseDetailResponse}) {
  const [playing,setPlaying]=useState(false);
  const offer=course.offers.find(o=>o.slug==="fully-booked-toolkit");
  const price=offer ? priceLabel(offer) : course.priceText;
  // The comparison comes from the source page's $197 + $247 resources.
  const sourcePromotion=offer?.amountCents===6700;
  const buy=()=>course.owned
    ? <LuxeButton to="/library/fully-booked-toolkit" variant="foil">Open your toolkit</LuxeButton>
    : offer?.available
      ? <LuxeButton to={`/checkout/${offer.slug}`} variant="foil">Get the toolkit — {price}</LuxeButton>
      : <p className="text-orchid">{offer?.unavailableReason || "Enrollment is currently unavailable."}</p>;
  return <>
    {sourcePromotion && <div className="bg-plum px-5 py-3 text-center text-sm font-semibold text-white">Flash Sale: Get 85% Off &amp; Book More Clients Today — Limited Time Offer!</div>}
    <Section className="pt-12 sm:pt-20">
      <Container>
        <Link to="/courses" className="text-sm font-semibold text-orchid">← The training library</Link>
        <div className="mt-6 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-gold">The Fully Booked Therapist Toolkit</p>
            <h1 className="mt-4 font-display text-3xl leading-tight text-ink sm:text-5xl">Struggling to Book More Clients? Watch This 3-Min Video to Discover the #1 Strategy Therapists Use to Get Fully Booked!</h1>
            <p className="mt-5 text-lg text-orchid">Watch Yvette’s 3 minute 24 second introduction.</p>
            <div className="mt-6 aspect-video overflow-hidden rounded-2xl border border-hairline bg-black shadow-xl">
              {playing ? <iframe
                src="https://fast.wistia.net/embed/iframe/v4rhn1rmdu?videoFoam=true&autoPlay=true"
                title="The Fully Booked Therapist Toolkit introduction"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
                className="size-full"
              /> : <button type="button" onClick={()=>setPlaying(true)}
                aria-label="Play the Fully Booked Toolkit introduction"
                className="group relative block size-full focus-visible:outline focus-visible:outline-4 focus-visible:outline-gold">
                <img src="/images/fully-booked-video-cover.webp"
                  alt="Yvette: I have something special just for you. Click here to play."
                  width={1920} height={1080} className="size-full object-contain" fetchPriority="high" />
                <span aria-hidden className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-plum px-4 py-2 text-sm font-semibold text-white shadow-lg group-hover:bg-black"><Play className="size-4" /> Play video</span>
              </button>}
            </div>
            <p className="mt-6 text-lg leading-relaxed text-orchid">I created this exclusive one-time offer to help you get visible, attract the right clients, and confidently convert them into bookings without wasting time guessing what works.</p>
          </div>
          <GlassCard spotlight={false} interactive={false} className="p-6 lg:sticky lg:top-24">
            <img src={`${root}/bundle.png`} alt="The Fully Booked Therapist Toolkit bundle" className="w-full rounded-xl" />
            <h2 className="mt-5 font-display text-2xl text-ink">Get the complete toolkit</h2>
            {sourcePromotion && <p className="mt-3 text-orchid">Total resource value: <span className="line-through">$444</span></p>}
            <p className="mt-2 font-display text-4xl text-ink">{price}</p>
            {sourcePromotion && <p className="mt-2 text-sm text-orchid">85% discount automatically applied.</p>}
            <div className="mt-5">{buy()}</div>
            <p className="mt-4 text-sm text-orchid">All sales are final as this is a digital product.</p>
          </GlassCard>
        </div>
      </Container>
    </Section>
    <Section>
      <Container className="max-w-5xl">
        <h2 className="font-display text-3xl text-ink">This Bundle Will Enable You To:</h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">{benefits.map(([title,body])=><li key={title} className="flex gap-3"><Check aria-hidden className="mt-1 size-5 shrink-0 text-gold"/><div><h3 className="font-semibold text-ink">{title}</h3><p className="mt-2 leading-relaxed text-orchid">{body}</p></div></li>)}</ul>
        <p className="mt-7 text-lg text-orchid">…Plus so much more to help you get fully booked faster!</p>
      </Container>
    </Section>
    <Section>
      <Container>
        <h2 className="text-center font-display text-3xl text-ink sm:text-4xl">What’s Inside The Proven Toolkit For a Fully Booked Practice</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <img src={`${root}/profile.png`} alt="From Profile to Profit guide and video tutorial" className="aspect-[4/3] w-full rounded-xl object-contain" loading="lazy" />
            <h3 className="mt-6 font-display text-2xl text-ink">From Profile to Profit</h3>
            <p className="mt-2 font-semibold text-gold">Total Value: $197</p>
            <p className="mt-4 text-orchid">Get the secrets to a standout therapist profile today!</p>
            <p className="mt-3 text-orchid">Elevate your online presence, attract more clients, and watch your practice thrive.</p>
            <p className="mt-3 text-orchid">Don’t wait — start transforming your profile into a client magnet now!</p>
            <h4 className="mt-5 font-semibold text-ink">Includes:</h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-orchid"><li>Comprehensive Profile Optimization Strategies</li><li>Proven Techniques to Increase Visibility and Engagement</li><li>Step-by-Step Guide and video tutorial to Enhance Your Online Reputation</li></ul>
          </GlassCard>
          <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
            <img src={`${root}/consultation.png`} alt="Client Consultation Call Script and video tutorial" className="aspect-[4/3] w-full rounded-xl object-contain" loading="lazy" />
            <h3 className="mt-6 font-display text-2xl text-ink">Client Consultation Call Script</h3>
            <p className="mt-2 font-semibold text-gold">Total Value: $247</p>
            <p className="mt-4 leading-relaxed text-orchid">This is the exact system I use to ensure my consultation calls are impactful and client-focused. Add the Client Consultation Call Script to your toolkit today, and gain instant access to a resource that will take your calls—and your practice—to the next level!</p>
            <h4 className="mt-5 font-semibold text-ink">Includes:</h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-orchid"><li>A proven step-by-step guided script and video tutorial.</li><li>Proven steps to help turn cold calls into paying clients.</li><li>Techniques to help eliminate objections or wanting to use insurance.</li></ul>
          </GlassCard>
        </div>
        <div className="mt-10 text-center"><p className="mb-4 text-lg text-orchid">Total value: $444 · Get the toolkit for {price}</p>{buy()}</div>
      </Container>
    </Section>
    <Section>
      <Container>
        <h2 className="text-center font-display text-3xl text-ink">What clinicians say about working with Yvette</h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">{testimonials.map(t=><GlassCard key={t.name} spotlight={false} interactive={false} className="p-7"><blockquote className="leading-relaxed text-orchid">“{t.quote}”</blockquote><p className="mt-5 font-semibold text-ink">{t.name}</p></GlassCard>)}</div>
      </Container>
    </Section>
    <Section className="pb-20">
      <Container className="max-w-4xl text-center">
        <h2 className="font-display text-3xl text-ink">The Fully Booked Therapist Toolkit</h2>
        <img src={`${root}/bundle-offer.png`} alt="Everything included in the Fully Booked Therapist Toolkit" className="mx-auto mt-8 w-full max-w-lg" loading="lazy" />
        <p className="mt-6 text-2xl font-semibold text-ink">{sourcePromotion ? "Get 85% off with this exclusive one-time offer!" : "Get the toolkit"} {price}</p>
        <p className="mt-3 text-orchid">All sales are final as this is a digital product.</p>
        <div className="mt-6">{buy()}</div>
        <img src={`${root}/trust-badges.png`} alt="Secure checkout" className="mx-auto mt-6 w-full max-w-sm" loading="lazy" />
        <div className="mt-8 grid grid-cols-2 gap-5"><img src={`${root}/profile-footer.png`} alt="From Profile to Profit resources" className="w-full" loading="lazy"/><img src={`${root}/consultation-footer.png`} alt="Consultation call resources" className="w-full" loading="lazy"/></div>
        <p className="mt-8 text-lg text-orchid">Take action now to start getting immediate results and start getting clients booked in your calendar.</p>
        <div className="mt-10 space-y-4 text-left text-xs leading-relaxed text-orchid-dim" aria-label="Results disclaimer">
          <p>Any case studies, examples, illustrations, or testimonials cannot guarantee that you will achieve similar results. Your results may vary significantly, and factors such as your personal effort and many other circumstances may and will cause results to vary.</p>
          <p>Any and all claims or representations as to income earnings on the site are not to be considered average earnings. There can be no assurance that any prior successes or past results can be used as an indication of your future success or results. Monetary and income results are based on many factors. We have no way of knowing how well you will do, your background, your work ethic, or your business skills or practices.</p>
          <p>We do not guarantee or imply that you will get rich, do as well, or make any money at all. If you rely upon figures provided on the site, you must accept the risk of not doing as well, just as with any program you join.</p>
        </div>
      </Container>
    </Section>
  </>;
}
