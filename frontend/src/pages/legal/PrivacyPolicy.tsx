import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

/* ── Document model ───────────────────────────────────────────────────────
   The live policy is a structured document — titled clauses, sub-headed
   groups and bulleted lists — so it is stored as that structure rather than
   as a flat paragraph array. The copy below is reproduced verbatim from
   bossclinician.com/privacy-policy; nothing is summarised or reordered. */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-10% 0px -6% 0px" } as const;

const LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);

const EMAIL = "yvette@bossclinician.com";

function Mail() {
  return (
    <a href={`mailto:${EMAIL}`} className={LINK}>
      {EMAIL}
    </a>
  );
}

/** Third-party references keep their original destinations. */
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

type Block =
  | { kind: "p"; body: ReactNode }
  | { kind: "h3"; body: string }
  | { kind: "ul"; items: ReactNode[] };

interface Clause {
  id: string;
  heading: string;
  blocks: Block[];
}

const CLAUSES: Clause[] = [
  {
    id: "introduction-and-summary",
    heading: "Introduction and Summary",
    blocks: [
      {
        kind: "p",
        body: "We want to make it easy for you to understand what information we collect from you, what we do with it, and how you can request access to this information.",
      },
      {
        kind: "p",
        body: (
          <>
            We believe this is a best practice to maintain transparency and trust with our website
            visitors and clients, and it just so happens that this complies with the laws of many
            countries around the world, too. If you have questions about this policy, you can
            contact us at <Mail />
          </>
        ),
      },
      {
        kind: "p",
        body: "We collect as little information from you as possible for a specific and identifiable purpose, and then we commit to using this information only in the way we have specified. When you visit this site, you are agreeing to this Privacy Policy, the collection of information identified in this policy, and you always have the ability to opt out.",
      },
    ],
  },
  {
    id: "what-personal-information-we-collect-and-when",
    heading: "What Personal Information We Collect and When",
    blocks: [
      {
        kind: "p",
        body: "We collect information so that we can make our products and services better tailored to the people who visit our site and do business with us. We collect this information to (i) deliver products and services you have purchased from us, (ii) to notify you about our product or service offerings that you may be interested in, so long as you have given us consent to do so, (iii) to keep track of visitor information to our site and/or or create retargeted and “lookalike” audiences for advertising purposes.",
      },
      {
        kind: "p",
        body: "We collect information from you directly and indirectly through third-party services, as follows:",
      },
      { kind: "h3", body: "When you contact us..." },
      {
        kind: "ul",
        items: [
          "With questions or comments in the contact form.",
          "When you comment on a post directly on the website.",
          "To request more information, schedule a telephone call, or sign up to the newsletter.",
          "To place an order for products or services.",
          "To receive your product or services.",
        ],
      },
      { kind: "h3", body: "When we contact you..." },
      {
        kind: "ul",
        items: [
          "To provide the goods and services you requested.",
          "To request occasional feedback.",
          "To provide news, updates, and offers through the newsletter, usually by email.",
        ],
      },
      { kind: "h3", body: "When we contact others..." },
      {
        kind: "ul",
        items: [
          "We may see certain personal information from third party apps and services that allow us to complete your order.",
          "We may see certain personal information from third party installations that allow us to remarket our services and products to you on other websites.",
          "We may see certain personal information from third party apps and services that allow us to monitor website traffic, email conversion, and other analytics data.",
          "We may see your personal information when we work with third party processors, like our email provider and web host. For EU residents, please note that this means we may transmit your data across international borders.",
        ],
      },
    ],
  },
  {
    id: "your-privacy-controls",
    heading: "Your Privacy Controls",
    blocks: [
      {
        kind: "p",
        body: "We use third-party services on our websites to assist in communicating or interacting with the public, including social media services, widgets, apps, pixels, and plugins, as further identified below. These services may distinguish or trace your identity, though, for example, persistent, multi-session cookies.",
      },
      {
        kind: "p",
        body: "You can configure your system to delete cookies or disable them. In general, we do not collect or disseminate information collected by these services. When interacting with these third parties, their privacy policies apply. As of the time of this writing, we use:",
      },
      {
        kind: "p",
        body: (
          <>
            Google Analytics: Specifically, Google Analytics collects data about visitors to the
            Site via{" "}
            <Ext href="http://www.google.com/policies/technologies/types/">
              Google advertising cookies
            </Ext>{" "}
            and{" "}
            <Ext href="https://www.google.com/policies/privacy/key-terms/#toc-terms-identifier">
              anonymous identifiers
            </Ext>
            , in addition to other data which may be collected through a standard Google Analytics
            implementation. We do not merge personally identifiable information with
            non-personally identifiable information collected through any Google advertising
            product or feature. Should you wish to opt out of any Google Analytics Advertising
            features, you are encouraged to change your Ad Settings and Ad Setting for mobile apps,
            through the NAI’s consumer opt-out, or by using any of the other opt-out options
            currently available:{" "}
            <Ext href="https://tools.google.com/dlpage/gaoptout/">currently available opt-out</Ext>
          </>
        ),
      },
      {
        kind: "p",
        body: (
          <>
            Paypal. More information is available{" "}
            <Ext href="https://www.paypal.com/webapps/mpp/ua/privacy-full">here</Ext>.
          </>
        ),
      },
      {
        kind: "p",
        body: (
          <>
            <Ext href="https://www.ftc.gov/site-information/privacy-policy/internet-cookies">
              Cookies
            </Ext>{" "}
            are small text files placed on your computer to collect information about the pages you
            view and your activities on the site. They enable the site to recognize you by, for
            example, remembering your username, offering a shopping cart, or keeping track of your
            preferences if you visit the site again. The cookie transmits this information back to
            the website's computer (or server) which generally is the only computer that can read
            it. You can set your Web browser to warn you about attempts to place cookies on your
            computer, or to limit the type of cookies you allow. See also{" "}
            <Ext href="http://www.usa.gov/optout-instructions.shtml">
              more information on how to change cookies settings in popular desktop browsers
            </Ext>
            .
          </>
        ),
      },
      {
        kind: "ul",
        items: [
          "This site uses single and multi-session cookies to enhance the visitor experience. Use the link above to opt out.",
          "This site does not sell or share its email list for use by third parties.",
        ],
      },
      {
        kind: "p",
        body: "If you choose to opt out of some or all of our data collection, you may not be able to access all features of this website or our services.",
      },
    ],
  },
  {
    id: "keeping-your-information-secure",
    heading: "Keeping Your Information Secure",
    blocks: [
      {
        kind: "p",
        body: "We store personal information with third parties that use industry standard practices for data security.",
      },
    ],
  },
  {
    id: "your-rights-to-your-information",
    heading: "Your Rights to Your Information",
    blocks: [
      {
        kind: "p",
        body: "You own your personal information and have rights to it. For example, you have the rights to:",
      },
      {
        kind: "ul",
        items: [
          <>
            Withdraw your consent for us to market our products and services to you and otherwise
            use the personal information you have provided to us. Withdrawing consent is easy.
            Simply click “unsubscribe” in the footer of our emails, or email <Mail />.
          </>,
          "Request a copy of the information we have about you.",
          "Be forgotten (that is, have your data deleted and/or ask us to stop using your information for any purpose);",
          "Correct inaccurate information we have about you (and that means we will notify other service providers we use, and who hold your personal information for us, of those changes as well);",
          "Object to direct marketing and profiling (for example, we will remove you from our email list and from any list we have uploaded for the purposes of creating custom or retargeted audiences). We also encourage you to disable data collection services on your browser.",
          "Make complaints about the use of your data to regulatory authorities.",
        ],
      },
      { kind: "p", body: "We will comply with these requests within 30 days." },
    ],
  },
  {
    id: "compliance",
    heading: "Compliance",
    blocks: [
      {
        kind: "p",
        body: "We make commercially reasonable efforts to work with data controllers (like our email provider) who guarantee compliance with privacy laws like the European Union’s General Data Protection Regulation.",
      },
      {
        kind: "p",
        body: "We store your personal information only for as long as it is needed to use it for the reasons you have consented to.",
      },
      {
        kind: "p",
        body: "Occasionally we will revise this policy and will use your contact information to notify you of these changes if they reduce your privacy rights in any way.",
      },
      {
        kind: "p",
        body: (
          <>
            Our data protection officer is Yvette Howard, at <Mail />
          </>
        ),
      },
    ],
  },
];

/** Dash-marked list, so the policy's bulleted clauses stay real list items. */
function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-5 space-y-3.5 first:mt-0">
      {items.map((item, i) => (
        <li key={i} className="copy-luxe flex gap-3.5">
          <span aria-hidden className="mt-[0.9em] h-px w-3 shrink-0 bg-gold/60" />
          <span className="min-w-0 text-pretty break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicy() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo
        title="Privacy Policy - Boss Clinician | Protecting Your Personal Information"
        description="Read our privacy policy to understand how we collect, use, and protect your personal data. Your privacy matters to us. Learn how we comply with global privacy laws and ensure transparency in how we handle your information."
      />

      <LuxePageHero
        eyebrow="Legal"
        title="Privacy Policy"
        tone="violet"
        actions={<LuxePill accent="gold">Updated 05/20/2024.</LuxePill>}
      />

      <Section surface="base" space="md" aria-label="Privacy Policy">
        <div className="mx-auto max-w-[62rem] xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8">
          <article className="mx-auto max-w-[70ch] space-y-10 xl:mx-0">
            {CLAUSES.map((clause) => (
              <motion.section
                key={clause.id}
                id={clause.id}
                aria-labelledby={`${clause.id}-heading`}
                className="scroll-mt-28"
                initial={reduce ? false : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={VIEWPORT}
                transition={{ duration: 0.7, ease: EASE }}
              >
                <GoldRule width="w-8" className="mb-5" />
                <h2
                  id={`${clause.id}-heading`}
                  className="text-balance font-display text-[1.3rem] font-medium leading-[1.3] text-white sm:text-[1.55rem]"
                >
                  {clause.heading}
                </h2>

                <div className="mt-6">
                  {clause.blocks.map((block, i) => {
                    if (block.kind === "h3") {
                      return (
                        <h3
                          key={i}
                          className="text-foil mt-8 font-display text-[1.05rem] italic leading-snug first:mt-0 sm:text-[1.15rem]"
                        >
                          {block.body}
                        </h3>
                      );
                    }

                    if (block.kind === "ul") return <Bullets key={i} items={block.items} />;

                    return (
                      <p key={i} className="copy-luxe mt-5 text-pretty break-words first:mt-0">
                        {block.body}
                      </p>
                    );
                  })}
                </div>
              </motion.section>
            ))}
          </article>

          <nav aria-label="Privacy Policy sections" className="hidden xl:block">
            <div className="sticky top-28">
              <GlassCard accent="gold" interactive={false} className="p-5">
                <ul className="max-h-[calc(100vh-11rem)] space-y-0.5 overflow-y-auto">
                  {CLAUSES.map((clause) => (
                    <li key={clause.id}>
                      <a
                        href={`#${clause.id}`}
                        className={cn(
                          "group flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2.5",
                          "text-sm leading-snug text-orchid-dim transition-colors duration-300",
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
