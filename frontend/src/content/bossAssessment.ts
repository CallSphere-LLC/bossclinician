/**
 * "Are You Running Your Practice — or Is It Running You?" — the Group Practice
 * Self-Assessment sign-up at /boss-assessment.
 *
 * Copied verbatim from the Kajabi page of the same path: a form that asks for
 * name, email and two questions about the practice, and promises the free
 * fillable PDF by email. The form is the builder form `boss-assessment`
 * (migration 099), which tags the contact "Group Practice Self-Assessment".
 *
 * The PDF itself is not on this site yet (it is not among the files imported
 * from Kajabi), so the email that delivers it — automation "Boss assessment —
 * send the Group Practice Self-Assessment" — is created PAUSED. Upload the PDF,
 * put its link in that email and switch the automation on.
 */

export const BOSS_ASSESSMENT = {
  eyebrow: "Group Practice Self-Assessment",
  titleLead: "Are You Running Your Practice —",
  titleAccent: "or Is It Running You?",
  sub: "A self-assessment for group practice owners who built the team — but still can't step back.",
  lead: "Enter your name and email and we'll send the free fillable PDF straight to your inbox.",
  firstName: "First Name",
  email: "Email",
  lastName: "Last Name",
  groupOwnerYears: {
    label: "How Long Have You Been A Group Practice Owner",
    options: ["I haven't hired just yet, but feel ready", "1-2 years", "3-4 years", "5-10+ years"],
  },
  teamSize: {
    label: "How Many Employees/Contractors Do You Have",
    options: ["1-2", "3-5", "5-10", "10+"],
  },
  submit: "I'M READY TO MAKE A CHANGE",
  disclaimer:
    "By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See our Privacy Policy and Terms.",
  formSlug: "boss-assessment",
  /** After sending. Not on the source page, which hands off to Kajabi's thank-you screen. */
  thanksHeading: "You're in.",
  thanksBody: "Thank you. Your free fillable Group Practice Self-Assessment will be sent to the email address you entered — keep an eye on your inbox, and your spam folder just in case.",
  thanksCta: { label: "Apply for the Boss Clinician Boardroom", to: "/boardroom" },
} as const;
