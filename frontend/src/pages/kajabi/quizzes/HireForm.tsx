import { useNavigate } from "react-router";
import { Seo } from "@/components/Seo";
import { Section } from "@/components/luxe/Section";
import { HIRE_FORM, HIRING_CONTACT_STORAGE_KEY } from "@/content/hiringQuiz";
import { LeadFormCard, type LeadContact } from "./LeadFormCard";

/**
 * /hire-form — the sign-up in front of the hiring quiz, rebuilt from the
 * Kajabi page of the same path (content/hiringQuiz.ts).
 *
 * Files the visitor under the `hire-form` builder form (migration 099: tag
 * "Hiring Quiz", the two practice questions stored on the contact), keeps
 * their name and email for this browser tab, and sends them on to
 * /hiring-quiz, which files their result for them so the result email reaches
 * the address they gave here.
 */
export default function HireForm() {
  const navigate = useNavigate();

  function handleSuccess(contact: LeadContact) {
    try {
      window.sessionStorage.setItem(HIRING_CONTACT_STORAGE_KEY, JSON.stringify(contact));
    } catch {
      // Private browsing: the quiz still runs and offers its own email form.
    }
    navigate("/hiring-quiz");
  }

  return (
    <>
      <Seo
        title="Are You Ready to Hire Your First Clinician? | Free Quiz"
        description="7 questions. 5 minutes. A clear, personalized answer — and an action plan no matter where you land."
        canonicalPath="/hire-form"
        noindex
      />
      <Section
        surface="deep"
        space="md"
        aurora="violet"
        auroraIntensity={0.6}
        seam={false}
        aria-label="Are You Ready to Hire Your First Clinician?"
        containerClassName="max-w-xl"
      >
        <header className="text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-gold/90">{HIRE_FORM.eyebrow}</p>
          <h1 className="mt-4 text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.5rem]">
            {HIRE_FORM.title} <em className="block italic text-gold">{HIRE_FORM.titleAccent}</em>
          </h1>
          <p className="copy-luxe mx-auto mt-4 max-w-[48ch] text-pretty">{HIRE_FORM.sub}</p>
          <p className="mt-5 font-semibold text-white">{HIRE_FORM.lead}</p>
        </header>
        <div className="mt-8">
          <LeadFormCard
            formSlug={HIRE_FORM.formSlug}
            selects={[
              { key: "years_in_practice", ...HIRE_FORM.practiceYears },
              { key: "years_group_owner", ...HIRE_FORM.groupOwnerYears },
            ]}
            submitLabel={HIRE_FORM.submit}
            disclaimer={HIRE_FORM.disclaimer}
            onSuccess={handleSuccess}
          />
        </div>
      </Section>
    </>
  );
}
