import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";

/* The agreement is reproduced verbatim from bossclinician.com/terms-of-use,
   clause for clause and in the site's order. Headings keep the document's own
   upper-case setting. */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-10% 0px -6% 0px" } as const;

const LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);

const EMAIL = "yvette@bossclinician.com";

interface Clause {
  id: string;
  /** `null` for the untitled opening of the agreement. */
  heading: string | null;
  paragraphs: ReactNode[];
}

const CLAUSES: Clause[] = [
  {
    id: "preamble",
    heading: null,
    paragraphs: [
      "This is a binding legal contract. Please read it in full.",
      "Welcome to Boss Clinician, Profitable Private Practice. This page is made available to you on the following conditions, and you consent to these terms by continuing to use the site. Please read them carefully, and if you disagree with any, navigate away from the site.",
      "Sometimes, you will be subject to additional terms and conditions, such as when you purchase something or disclaimers which may appear on the site.",
    ],
  },
  {
    id: "privacy-policy",
    heading: "PRIVACY POLICY",
    paragraphs: [
      "To learn how we handle information that we learn about visitors to our site, please visit our privacy policy page.",
    ],
  },
  {
    id: "electronic-communications",
    heading: "ELECTRONIC COMMUNICATIONS",
    paragraphs: [
      "You consent to receive communications from us electronically and agree that any notices or disclosures we are required to provide to you now or in the future may be provided to you in electronic form.",
    ],
  },
  {
    id: "our-copyrights",
    heading: "OUR COPYRIGHTS",
    paragraphs: [
      "The content you see here, including text, images, custom software, compilations of resources, and audio and video content, or made available by the site elsewhere, is the sole and exclusive property of Boss Clinician. It is protected by United States and international copyright laws. We take our intellectual property rights seriously and search for infringing uses of our copyrighted material, such as copying, passing off as your own, or other infringing uses, whether personal or commercial. If you desire to use the information on this website other than by viewing it for your personal use, we offer licenses, starting at $5,000 each, to do so. If you are found using the information other than as explicitly allowed by this agreement, we will notify you and bill you accordingly.",
    ],
  },
  {
    id: "our-trademarks",
    heading: "OUR TRADEMARKS",
    paragraphs: [
      "Logos, slogans and catchphrases, design aspects of the site, icons, scripts, and service names which appear on the site or elsewhere are trademarks of Boss Clinician and protected by U.S. law. These trademarks help consumers identify Independent Mind as the source of the information or materials bearing the logo, slogan, or other trademarked design. They may not be used by you in any way that is likely to cause confusion among consumers, implies a connection or endorsement, or that undermines or discredits the brand.",
    ],
  },
  {
    id: "access-restrictions",
    heading: "ACCESS RESTRICTIONS",
    paragraphs: [
      "You are permitted to use the site for personal and non-commercial use. This means you cannot resell or make other commercial use of any of the content on this site, such as by downloading, copying, duplicating, reproducing, or otherwise removing information from the site for your (or a third party’s) commercial benefit, whether manually or by electronic means. We reserve all rights, including those not expressly granted in these Terms or elsewhere on the site.",
      "You may not engage in tactics to gain an unpermitted benefit from the site, such as hiding logos or content to improve search rankings.",
      "You are responsible for understanding the laws of your jurisdiction as they pertain to using a website like this one, and agree to be bound by the requirements of those laws.",
      "The limited license you are granted to use this site is terminated if you violate any of these Terms.",
    ],
  },
  {
    id: "copyright-issues",
    heading: "COPYRIGHT ISSUES",
    paragraphs: [
      <>
        We take copyright issues seriously. If you feel we have infringed upon your copyrights,
        please contact us at{" "}
        <a href={`mailto:${EMAIL}`} className={LINK}>
          {EMAIL}
        </a>
        . We will promptly investigate the matter.
      </>,
    ],
  },
  {
    id: "other-parties-information",
    heading: "OTHER PARTIES’ INFORMATION",
    paragraphs: [
      "Occasionally, we will post about, or allow other parties to post about, information and services provided by companies other than Boss Clinician. We do not warrant the offerings of these companies or the safety of their websites. We do not assume any responsibility for their actions, or the outcome of using their products or content. You are advised, and agree, to review the terms and privacy policy governing the information, services, and goods of third parties you may learn about on this site.",
    ],
  },
  {
    id: "disclaimer-of-warranties",
    heading: "DISCLAIMER OF WARRANTIES; USE AT YOUR OWN RISK",
    paragraphs: [
      'THE INFORMATION AND CONTENT MADE AVAILABLE TO YOU ON THE SITE IS PROVIDED "AS IS" AND "AS AVAILABLE." WE MAKE NO REPRESENTATIONS OR WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, AS TO THE INFORMATION, CONTENT, MATERIALS, SERVICES, OR PRODUCTS AVAILABLE HERE. YOU EXPRESSLY AGREE THAT YOUR USE OF THE SITE OR ANY PART OF IT IS AT YOUR SOLE RISK.',
      "TO THE FULL EXTENT PERMISSIBLE BY APPLICABLE LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. WE DO NOT WARRANT THAT THE INFORMATION, CONTENT, MATERIALS, OR OTHER SERVICES PROVIDED BY THE SITE ARE FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS. WE WILL NOT BE LIABLE FOR ANY DAMAGES OF ANY KIND ARISING FROM THE USE OF INFORMATION, CONTENT, OR OTHER MATERIALS OR SERVICES INCLUDED ON THE SITE, INCLUDING, BUT NOT LIMITED TO DIRECT, INDIRECT, INCIDENTAL, PUNITIVE, AND CONSEQUENTIAL DAMAGES, TO THE EXTENT YOUR STATE LAW ALLOWS FOR SUCH DISCLAIMERS.",
    ],
  },
  {
    id: "governing-law",
    heading: "GOVERNING LAW",
    paragraphs: [
      "By using the site, you agree that any dispute related to these terms or with Boss Clinician will be governed by the laws of the state of Nevada, without regard to principles of conflict of laws, and you agree to submit to personal jurisdiction of Nevada.",
    ],
  },
  {
    id: "amendments-and-other-matters",
    heading: "AMENDMENTS AND OTHER MATTERS",
    paragraphs: [
      "We may make changes to the site, our offerings or information, and these terms at any time and without prior notice.",
      "If any of these terms is deemed invalid for any reason, that term shall be severable and the remaining terms shall be given their maximum effect.",
      "By using this site, you certify that you are over the age of eighteen.",
      "If you make a purchase on this website, you are subject to this agreement and others, including our no refunds policies, if any.",
    ],
  },
];

const INDEX = CLAUSES.filter((clause) => clause.heading !== null);

export default function Terms() {
  const reduce = useReducedMotion();

  return (
    <>
      <Seo
        title="Terms of Use for Boss Clinician | Legal Agreement"
        description="Please read our Terms of Use for important information regarding the rules and guidelines for using the Boss Clinician website. By using the site, you agree to comply with these terms."
      />

      <LuxePageHero
        eyebrow="Legal"
        title="Terms of Use"
        tone="plum"
        actions={<LuxePill accent="gold">Updated 5/19/2025</LuxePill>}
      />

      <Section surface="base" space="md" aria-label="Terms of Use">
        <div className="mx-auto max-w-[62rem] xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8">
          <article className="mx-auto max-w-[70ch] space-y-10 xl:mx-0">
            {CLAUSES.map((clause) => (
              <motion.section
                key={clause.id}
                id={clause.id}
                aria-labelledby={clause.heading ? `${clause.id}-heading` : undefined}
                className="scroll-mt-28"
                initial={reduce ? false : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={VIEWPORT}
                transition={{ duration: 0.7, ease: EASE }}
              >
                {clause.heading && (
                  <>
                    <GoldRule width="w-8" className="mb-5" />
                    <h2
                      id={`${clause.id}-heading`}
                      className="text-balance font-display text-[1.1rem] font-medium leading-[1.35] tracking-[0.05em] text-white sm:text-[1.3rem]"
                    >
                      {clause.heading}
                    </h2>
                  </>
                )}

                <div className={cn("space-y-5", clause.heading && "mt-6")}>
                  {clause.paragraphs.map((paragraph, i) => (
                    <p
                      key={i}
                      className={cn(
                        "copy-luxe text-pretty break-words",
                        // The agreement opens on its own weight, not a heading.
                        clause.id === "preamble" && i === 0 && "text-white sm:text-[1.06rem]",
                      )}
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </motion.section>
            ))}
          </article>

          <nav aria-label="Terms of Use sections" className="hidden xl:block">
            <div className="sticky top-28">
              <GlassCard accent="gold" interactive={false} className="p-5">
                <ul className="max-h-[calc(100vh-11rem)] space-y-0.5 overflow-y-auto">
                  {INDEX.map((clause) => (
                    <li key={clause.id}>
                      <a
                        href={`#${clause.id}`}
                        className={cn(
                          "group flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2.5",
                          "text-[0.78rem] leading-snug tracking-[0.04em] text-orchid-dim",
                          "transition-colors duration-300",
                          "hover:bg-white/[0.05] hover:text-white",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                        )}
                      >
                        <span
                          aria-hidden
                          className="h-px w-3 shrink-0 bg-gold/50 transition-all duration-300 group-hover:w-5 group-hover:bg-gold"
                        />
                        <span className="min-w-0">{clause.heading}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
          </nav>
        </div>
      </Section>
    </>
  );
}
