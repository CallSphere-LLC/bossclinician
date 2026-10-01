import { useState } from "react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { BOSS_ASSESSMENT } from "@/content/bossAssessment";
import { LeadFormCard, type LeadContact } from "./LeadFormCard";
import { useFocusOnChange } from "./shared";

/**
 * /boss-assessment — the Group Practice Self-Assessment sign-up, rebuilt from
 * the Kajabi page of the same path (content/bossAssessment.ts).
 *
 * Files the visitor under the `boss-assessment` builder form (migration 099:
 * tag "Group Practice Self-Assessment", the two practice questions stored on
 * the contact) and thanks them in place. The email that delivers the PDF is a
 * paused automation until the PDF is uploaded — see content/bossAssessment.ts.
 */
export default function BossAssessment() {
  const { arm, focusOnMount } = useFocusOnChange();
  const [done, setDone] = useState<LeadContact | null>(null);
  const a = BOSS_ASSESSMENT;

  return (
    <>
      <Seo
        title="Group Practice Self-Assessment | Are You Running Your Practice — or Is It Running You?"
        description="A self-assessment for group practice owners who built the team — but still can't step back."
        canonicalPath="/boss-assessment"
      />
      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Group Practice Self-Assessment"
        containerClassName="max-w-xl"
      >
        <header className="text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{a.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.5rem]">
            {a.titleLead} <em className="italic text-gold">{a.titleAccent}</em>
          </h1>
          <p className="copy-luxe mx-auto mt-4 max-w-[48ch] text-pretty">{a.sub}</p>
          {!done && <p className="mt-5 font-semibold text-white">{a.lead}</p>}
        </header>

        <div className="mt-8">
          {done ? (
            <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 text-center sm:p-9">
              <h2
                ref={focusOnMount}
                tabIndex={-1}
                className="font-display text-[1.8rem] font-medium leading-tight text-white outline-none"
              >
                {a.thanksHeading}
              </h2>
              <GoldRule className="mx-auto mt-5" />
              <p className="copy-luxe mx-auto mt-5 max-w-[46ch] text-pretty">{a.thanksBody}</p>
              <LuxeButton variant="foil" size="md" to={a.thanksCta.to} className="mt-7 min-h-[44px] max-w-full">
                {a.thanksCta.label}
              </LuxeButton>
            </GlassCard>
          ) : (
            <LeadFormCard
              formSlug={a.formSlug}
              selects={[
                { key: "years_group_owner", ...a.groupOwnerYears },
                { key: "team_size", ...a.teamSize },
              ]}
              submitLabel={a.submit}
              disclaimer={a.disclaimer}
              onSuccess={(contact) => {
                arm();
                setDone(contact);
              }}
            />
          )}
        </div>
      </Section>
    </>
  );
}
