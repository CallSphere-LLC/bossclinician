import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-10% 0px -6% 0px" } as const;

/**
 * The disclaimer as published at bossclinician.com/disclaimer.
 *
 * The live page states this notice twice inside a single paragraph — the
 * second half is a character-for-character repeat of the first. It is
 * reproduced that way rather than de-duplicated, so the page carries exactly
 * the text the published document carries. Held once and rendered twice so
 * the two halves cannot drift apart.
 */
const NOTICE =
  "ANY CASE STUDIES, EXAMPLES, ILLUSTRATIONS, OR TESTIMONIALS CANNOT GUARANTEE THAT YOU WILL ACHIEVE SIMILAR RESULTS. IN FACT, YOUR RESULTS MAY VARY SIGNIFICANTLY AND FACTORS SUCH AS YOUR PERSONAL EFFORT AND MANY OTHER CIRCUMSTANCES MAY AND WILL CAUSE RESULTS TO VARY. ANY AND ALL CLAIMS OR REPRESENTATIONS, AS TO INCOME EARNINGS ON THE SITE, ARE NOT TO BE CONSIDERED AS AVERAGE EARNINGS. THERE CAN BE NO ASSURANCE THAT ANY PRIOR SUCCESSES, OR PAST RESULTS, AS TO INCOME EARNINGS, CAN BE USED AS AN INDICATION OF YOUR FUTURE SUCCESS OR RESULTS. MONETARY AND INCOME RESULTS ARE BASED ON MANY FACTORS. WE HAVE NO WAY OF KNOWING HOW WELL YOU WILL DO, AS THEY DO NOT KNOW YOU, YOUR BACKGROUND, YOUR WORK ETHIC, OR YOUR BUSINESS SKILLS OR PRACTICES. THEREFORE, WE DO NOT GUARANTEE OR IMPLY THAT YOU WILL GET RICH, THAT YOU WILL DO AS WELL, OR THAT YOU WILL MAKE ANY MONEY AT ALL. IF YOU RELY UPON FIGURES PROVIDED IN THE SITE; YOU MUST ACCEPT THE RISK OF NOT DOING AS WELL - JUST AS YOU WOULD WITH ANY PROGRAM YOU JOIN.";

export default function Disclaimer() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo
        title="Disclaimer for Boss Clinician | Important Notice"
        description="Please read our Disclaimer for important information regarding the use of case studies, testimonials, and income claims on this website. Results may vary significantly, and there is no guarantee of success."
      />

      <LuxePageHero eyebrow="Legal" title="Disclaimer" tone="gold" />

      <Section surface="base" space="md" aria-label="Disclaimer">
        <motion.article
          className="mx-auto max-w-[70ch]"
          initial={reduce ? false : { opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <p className="copy-luxe text-pretty break-words tracking-[0.02em]">
            {`${NOTICE} ${NOTICE}`}
          </p>
        </motion.article>
      </Section>
    </>
  );
}
