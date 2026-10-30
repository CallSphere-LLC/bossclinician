import type { KajabiFieldSpec } from "@/pages/kajabi/pages/shared";

/**
 * Credential For You (sheet row 214): the sales page, the page after purchase,
 * and the two forms, in the owner's wording from her page and her directions.
 *
 * The slugs, and each form's keys, are one contract with migration 181.
 */

/** The three paid offers are drafts until the owner settles their terms (migration 181). */
const CHECKOUTS_OPEN = false as boolean;
const CHECKOUT = (slug: string) => `/checkout/${slug}`;

export const REQUEST_PATH = "/credentialing-request";
export const INTAKE_PATH = "/credentialing-intake";

/** The service question's choices, in her order. Also what a `?service=` link may preselect. */
export const REQUEST_SERVICES = [
  "Commercial Insurance",
  "Medicare",
  "Medicaid",
  "TRICARE / Federal Plan",
  "Group Enrollment",
  "Adding Provider to Existing Group",
  "CAQH",
  "Recredentialing",
  "Ongoing Credentialing Maintenance",
  "Not Sure",
] as const;

type RequestService = (typeof REQUEST_SERVICES)[number];

const requestLink = (service: RequestService) =>
  `${REQUEST_PATH}?service=${encodeURIComponent(service)}`;

const startCta = (label: string, slug: string, service: RequestService) =>
  CHECKOUTS_OPEN
    ? { label, to: CHECKOUT(slug) }
    : { label: "Request Credentialing Support", to: requestLink(service) };

/** Her official start-date language (section 14 of the directions). */
export const START_DATE_LINES = [
  "Your credentialing timeline begins once your intake is complete and all required documents have been received.",
  "The purchase date is not automatically the credentialing start date.",
] as const;

export interface CredentialService {
  label: string;
  title: string;
  price: string;
  body: string;
  items: readonly string[];
  cta: { label: string; to: string };
  featured?: boolean;
}

export const credentialForYou = {
  seo: {
    title: "Credentialing Support for Mental Health Providers | Boss Clinician",
    description:
      "Credentialing support for therapists and mental health providers. Get help with commercial insurance, Medicare, Medicaid, TRICARE, CAQH, payer follow-up, and enrollment tracking.",
  },
  hero: {
    eyebrow: "Credentialing Support for Mental Health Providers",
    title: "Get credentialed without",
    titleAccent: "managing every step yourself.",
    lede: "Boss Clinician Credentialing Support helps therapists and mental health providers organize, submit, track, and follow up on insurance enrollment applications — so you can spend less time chasing payer portals and more time building your practice.",
    primary: "Choose Your Credentialing Support",
    secondary: "See How It Works",
    options: "View Credentialing Options",
    cardTitle: "Support may include:",
    cardItems: [
      "Commercial insurance enrollment",
      "Medicare / PECOS enrollment",
      "Medicaid and state plan enrollment",
      "TRICARE / federal plan credentialing",
      "CAQH setup and updates",
      "Payer follow-up and status tracking",
      "Effective-date confirmation when available",
    ],
  },
  intro: {
    eyebrow: "Credentialing can be simple. It just shouldn’t be random.",
    title: "Submitting the application is only part of the process.",
    body: "Every payer seems to have its own portal, documentation requirements, follow-up process, and timeline. Our goal is to help you keep the process organized and moving from application through payer determination.",
    questions: [
      "“Did they receive my application?”",
      "“Do I need to follow up again?”",
      "“Am I missing something?”",
      "“When can I start seeing clients under this plan?”",
    ],
  },
  services: {
    eyebrow: "Choose the support you need",
    title: "Credentialing options for your practice.",
    body: "Whether you need help with one payer or several, choose the service that best fits your current credentialing needs.",
    cards: [
      {
        label: "Commercial Insurance",
        title: "Commercial Insurance Credentialing",
        price: "$225 per payer / provider",
        body: "For providers enrolling with commercial insurance companies.",
        items: [
          "Provider information review",
          "CAQH review/update as needed",
          "Payer application preparation",
          "Application submission",
          "Routine status follow-up",
          "Response to standard payer requests",
          "Tracking through payer determination",
          "Effective-date confirmation when provided",
        ],
        cta: startCta("Start Commercial Credentialing", "credential-for-you-commercial", "Commercial Insurance"),
        featured: false,
      },
      {
        label: "Original Medicare",
        title: "Medicare Credentialing",
        price: "$497 per provider",
        body: "Need Medicare only? You do not need to purchase a larger credentialing package.",
        items: [
          "PECOS enrollment or applicable reassignment",
          "Required Medicare enrollment information",
          "EFT enrollment support",
          "Application preparation and submission",
          "Routine status follow-up",
          "Response to standard development requests",
          "Enrollment status tracking",
          "Final enrollment confirmation when available",
        ],
        cta: startCta("Start Medicare Credentialing", "credential-for-you-medicare", "Medicare"),
        featured: true,
      },
      {
        label: "State Plans",
        title: "Medicaid Credentialing",
        price: "Starting at $450",
        body: "Medicaid enrollment varies by state and program, so scope is reviewed before services begin.",
        items: [
          "State enrollment application support",
          "Provider profile review",
          "Required documentation review",
          "Application submission",
          "Routine follow-up",
          "Status tracking through determination",
        ],
        cta: { label: "Request Medicaid Credentialing", to: requestLink("Medicaid") },
        featured: false,
      },
      {
        label: "Federal Plans",
        title: "TRICARE / Federal Plan Credentialing",
        price: "Starting at $425",
        body: "For providers seeking enrollment with TRICARE or another eligible federal health plan.",
        items: [
          "Enrollment requirement review",
          "Application preparation",
          "Application submission",
          "Routine payer follow-up",
          "Status tracking",
        ],
        cta: { label: "Request Federal Plan Credentialing", to: requestLink("TRICARE / Federal Plan") },
        featured: false,
      },
    ] satisfies readonly CredentialService[],
  },
  package: {
    eyebrow: "Need several payers?",
    title: "Provider Credentialing Package",
    price: "Starting at $1,997",
    body: "Designed for providers who want support establishing a broader insurance-based practice without managing multiple payer applications on their own.",
    items: [
      "CAQH setup or review",
      "Up to 6 commercial payer applications",
      "Application preparation",
      "Application submission",
      "Payer follow-up",
      "Credentialing tracker",
      "Effective-date tracking",
      "Final credentialing status summary",
    ],
    note: "Medicare, Medicaid, TRICARE, group enrollment, or other complex enrollment needs may be added separately.",
    cta: startCta("Start My Credentialing Package", "credential-for-you-package", "Commercial Insurance"),
  },
  additional: {
    eyebrow: "Additional credentialing services",
    title: "Need something more specific?",
    // Her page draws these without buttons; her section 6 gives each a destination
    // and section 4 the two labels a quoted service may use.
    cards: [
      { title: "CAQH Setup or Major Cleanup", price: "Starting at $250", cta: "Request a Quote", to: requestLink("CAQH") },
      { title: "CAQH Re-Attestation / Routine Update", price: "Starting at $125", cta: "Request a Quote", to: requestLink("CAQH") },
      { title: "Recredentialing", price: "Starting at $175 per payer", cta: "Request a Quote", to: requestLink("Recredentialing") },
      { title: "Group Enrollment", price: "Quoted based on payer and enrollment requirements.", cta: "Request a Quote", to: requestLink("Group Enrollment") },
      { title: "Additional Provider Under Existing Group", price: "Quoted based on payer and scope.", cta: "Request a Quote", to: requestLink("Adding Provider to Existing Group") },
      { title: "Ongoing Credentialing Maintenance", price: "Available by request.", cta: "Request Credentialing Support", to: requestLink("Ongoing Credentialing Maintenance") },
    ],
  },
  process: {
    eyebrow: "What happens after you purchase?",
    title: "A clear process from intake to payer determination.",
    steps: [
      { number: "Step 01", title: "Complete Your Intake", body: "Provide the provider and practice information needed for your selected payer enrollment." },
      { number: "Step 02", title: "Document Review", body: "We review your submission and identify any missing information before preparing the application." },
      { number: "Step 03", title: "Application Submission", body: "Once your information is complete, the included payer applications are prepared and submitted." },
      { number: "Step 04", title: "Follow-Up", body: "Our team performs routine follow-up and responds to standard payer requests during the process." },
      { number: "Step 05", title: "Status Confirmation", body: "When the payer issues a determination, we provide the available enrollment and effective-date information." },
    ],
  },
  prepare: {
    eyebrow: "What we may request",
    title: "Be prepared to provide:",
    items: [
      "Professional license information",
      "NPI information",
      "Malpractice coverage",
      "Education and training history",
      "Practice information",
      "W-9 / tax information",
      "CAQH information",
      "Banking / EFT information",
      "Group information when applicable",
    ],
  },
  role: {
    eyebrow: "Your role in the process",
    title: "Credentialing moves fastest when we have what we need.",
    items: [
      "Provide accurate provider and practice information",
      "Provide requested documentation promptly",
      "Maintain active licensure and malpractice coverage",
      "Review and sign documents when required",
      "Respond to credentialing team requests",
      "Maintain access to accounts requiring provider authentication",
    ],
  },
  disclaimer: {
    eyebrow: "Before you purchase",
    title: "Credentialing support does not guarantee payer approval.",
    body: "Insurance companies and government programs make their own enrollment, contracting, reimbursement, panel, and effective-date decisions.",
    lead: "Boss Clinician Credentialing Support cannot guarantee:",
    items: [
      "Acceptance into an insurance network",
      "An open payer panel",
      "A particular reimbursement rate",
      "A specific credentialing completion date",
      "Retroactive payment",
      "Payer approval or contracting terms",
    ],
    closing: "Credentialing timelines may be affected by payer processing times, panel availability, provider type, state requirements, missing documentation, or requests for additional information.",
  },
  final: {
    eyebrow: "Ready to get started?",
    title: "You don’t have to manage the credentialing process alone.",
    body: "Choose the level of support that fits your practice, complete your intake, and let our team help you keep the process organized from application through payer determination.",
    cta: "Choose Credentialing Support",
  },
} as const;

export const credentialingNextSteps = {
  seo: {
    title: "Credentialing Support — Next Steps | Boss Clinician",
    description: "Complete your credentialing intake and provide the documentation needed for your enrollment.",
  },
  title: "You're In. Let's Get Your Credentialing Started.",
  paragraphs: [
    "Thank you for trusting Boss Clinician with your credentialing support.",
    "Your next step is to complete your credentialing intake and provide the documentation needed for your enrollment.",
  ],
  important: "Your credentialing timeline begins once your intake is complete and all required documentation has been received.",
  cta: "Complete My Credentialing Intake",
} as const;

export const credentialingRequest = {
  seo: {
    title: "Request Credentialing Support | Boss Clinician",
    description: "Tell us what you need and we will follow up about credentialing support for your practice.",
  },
  eyebrow: "Credential For You",
  title: "Request Credentialing Support",
  submit: "Request Credentialing Support",
  success: "Thank you. Your credentialing request is in, and we will follow up with you.",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, autoComplete: "name", half: true },
    { key: "email", label: "Email", type: "email", required: true, half: true },
    { key: "phone", label: "Phone", type: "text", required: true, autoComplete: "tel", half: true },
    { key: "practice_name", label: "Practice Name", type: "text", autoComplete: "organization", half: true },
    { key: "state", label: "State", type: "text", required: true, half: true },
    { key: "license_type", label: "License Type", type: "text", required: true, half: true },
    { key: "provider_or_group", label: "Individual Provider or Group Practice", type: "radio", required: true, options: ["Individual Provider", "Group Practice"] },
    { key: "service", label: "Which service do you need?", type: "select", required: true, options: REQUEST_SERVICES },
    { key: "payer", label: "Insurance payer or program requested", type: "text" },
    { key: "provider_count", label: "Number of providers needing credentialing", type: "text", required: true },
    { key: "currently_enrolled", label: "Are you currently enrolled with this payer?", type: "radio", options: ["Yes", "No", "Not Sure"] },
    { key: "message", label: "Anything else we should know?", type: "textarea" },
  ] satisfies readonly KajabiFieldSpec[],
} as const;

export const credentialingIntake = {
  seo: {
    title: "Credentialing Intake | Boss Clinician",
    description: "The provider and practice information needed to begin your credentialing support.",
  },
  eyebrow: "Credential For You",
  title: "Credentialing Intake",
  notice: "Please do not enter banking details, a Social Security number or a date of birth on this form.",
  submit: "Submit My Credentialing Intake",
  success: "Thank you. Your credentialing intake is in.",
  fields: [
    { key: "name", label: "Provider legal name", type: "text", required: true, autoComplete: "name", half: true },
    { key: "email", label: "Email used at checkout", type: "email", required: true, half: true },
    { key: "phone", label: "Phone", type: "text", required: true, autoComplete: "tel", half: true },
    {
      key: "service_purchased",
      label: "Service purchased",
      type: "select",
      required: true,
      half: true,
      options: ["Commercial Insurance Credentialing", "Medicare Credentialing Support", "Provider Credentialing Package", "Other credentialing service"],
    },
    { key: "practice_legal_name", label: "Practice/legal business name", type: "text", required: true, autoComplete: "organization" },
    { key: "npi_type_1", label: "NPI Type 1", type: "text", required: true, half: true },
    { key: "npi_type_2", label: "NPI Type 2 if applicable", type: "text", half: true },
    { key: "tax_id", label: "Tax ID/EIN (EIN only, like 12-3456789. Leave blank rather than enter a Social Security number.)", type: "text", autoComplete: "off" },
    { key: "practice_address", label: "Practice address", type: "textarea", required: true },
    { key: "billing_address", label: "Billing address", type: "textarea", required: true },
    { key: "service_locations", label: "Service locations", type: "textarea", required: true },
    { key: "license_information", label: "Professional license information", type: "textarea", required: true },
    { key: "malpractice_information", label: "Malpractice insurance information", type: "textarea", required: true },
    { key: "education_training", label: "Education and training history", type: "textarea", required: true },
    { key: "caqh_information", label: "CAQH information", type: "textarea" },
    { key: "payer_selections", label: "Payer selections", type: "textarea", required: true },
    { key: "existing_enrollment", label: "Existing enrollment information", type: "textarea" },
    { key: "group_affiliations", label: "Group affiliations", type: "textarea" },
    { key: "other_payer_information", label: "Other payer-specific information needed to determine next steps", type: "textarea" },
  ] satisfies readonly KajabiFieldSpec[],
} as const;
