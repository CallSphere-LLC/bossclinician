/**
 * The legal agreements bossclinician.com kept as separate Kajabi pages, copied
 * word for word from the live pages (October 2026).
 *
 * Kajabi typos and placeholders are kept exactly as published — this file is a
 * record of what Yvette's site said, not an edit of it. The only changes are to
 * addresses: links that pointed at www.bossclinician.com now point at this
 * site's own page for the same thing (the visible text is unchanged).
 *
 * Plain data, no JSX, so the copy can be diffed against the source and read by
 * anything that is not React. `KajabiLegalDocument` renders it.
 */

/** A run of text with optional emphasis or a link. */
export type LegalSpan =
  | string
  | { text: string; href?: string; bold?: true; italic?: true };

/** One paragraph's worth of inline content. */
export type LegalText = string | readonly LegalSpan[];

export type LegalBlock =
  | {
      type: "p";
      text: LegalText;
      /** `note` is set in italics (Kajabi's italic asides); `callout` is a boxed warning. */
      tone?: "note" | "callout";
    }
  | { type: "list"; items: readonly LegalText[] }
  | { type: "subhead"; text: string }
  | {
      type: "pricing";
      options: readonly { eyebrow: string; name: string; price: string; per?: string; note: readonly string[] }[];
    };

export interface LegalClause {
  id: string;
  /** Small label over the heading ("Section 04"). */
  label?: string;
  /** `null` for an untitled opening. */
  heading: string | null;
  blocks: readonly LegalBlock[];
}

export interface KajabiLegalDoc {
  seo: { title: string; description: string; image?: string; canonicalPath?: string };
  eyebrow: string;
  title: string;
  titleAccent?: string;
  /** Under the headline. */
  lede?: string;
  /** Gold pill in the hero: the document's date line. */
  dateLine?: string;
  /** A letterhead image set above the document body (self-hosted). */
  letterhead?: { src: string; alt: string };
  clauses: readonly LegalClause[];
  /** A closing "questions?" card. */
  contact?: { heading: string; body: string; email: string; lines: readonly string[] };
}

const LEGAL_SHARE_IMAGE = "/images/kajabi-pages/legal/legal-share.jpg";

/* ══════════════════════════════════════════════════════════════════════════
   /coaching-terms
   ══════════════════════════════════════════════════════════════════════════ */

const WORK_WITH_ME_URL = "bossclinician.callsphere.site/work-with-me";

export const coachingTerms: KajabiLegalDoc = {
  seo: {
    title: "Coaching Contract for Boss Clinician | Legal Agreement",
    description:
      "Please read our Coaching Contract for important information regarding the rules and guidelines for working with Yvette",
    image: LEGAL_SHARE_IMAGE,
  },
  eyebrow: "Legal",
  title: "Coaching Agreement",
  dateLine: "Last updated: December 01, 2025.",
  letterhead: {
    src: "/images/kajabi-pages/coaching-terms/coaching-agreement.webp",
    alt: "Boss Clinician — Self Made, Self Paid",
  },
  clauses: [
    {
      id: "preamble",
      heading: null,
      blocks: [
        { type: "p", text: "This Coaching Agreement (“Agreement”) is entered into by and between:" },
        { type: "p", text: "Boss Clinician, LLC" },
        { type: "p", text: "848 N Rainbow Blvd #441, Las Vegas, NV 89107" },
        { type: "p", text: "yvette@proftitableprivatepractices.com" },
        {
          type: "p",
          text: [
            "and client within each coaching package listed on ",
            { text: WORK_WITH_ME_URL, href: "/work-with-me", bold: true },
            " and the Aligned Practice Intensive",
          ],
        },
        { type: "p", text: "Coach and Client are collectively referred to as the “Parties.”" },
      ],
    },
    {
      id: "purpose",
      heading: "PURPOSE",
      blocks: [
        {
          type: "p",
          text: "Coach will provide and Client will pay for business coaching and mentorship in accordance with the terms and conditions of this Agreement.",
        },
      ],
    },
    {
      id: "contract-date",
      heading: "CONTRACT DATE",
      blocks: [{ type: "p", text: "This Agreement is effective upon the date of the initial client investment." }],
    },
    {
      id: "the-coaching-relationship",
      heading: "THE COACHING RELATIONSHIP",
      blocks: [
        {
          type: "p",
          text: "Client acknowledges that coaching is a team effort, and Client will get out of coaching only as much as he or she puts into it. Client agrees to fully participate in coaching and follow the Coach’s instructions to his or her best ability. Client agrees to communicate honestly, be open to feedback and assistance and to create the time and energy to participate fully in the program.",
        },
        {
          type: "p",
          text: "Client acknowledges that Client is solely responsible for creating and implementing his or her own decisions, choices, actions and results based on coaching calls, sessions, and interactions with Coach. Client agrees that the Coach is not and will not be liable or responsible for any action or inaction, or for any direct or indirect result of any services provided by the Coach. Client understands coaching is not therapy and does not substitute for therapy if needed, and does not prevent, cure, or treat any mental disorder or medical disease.",
        },
        {
          type: "p",
          text: "Client acknowledges that coaching is a comprehensive process that may involve different areas of his or her life, including work, finances, health, relationships, education and recreation. Client agrees that deciding how to handle these issues, incorporate coaching principles into those areas and implementing choices is exclusively the Client’s responsibility.",
        },
        {
          type: "p",
          text: "Client acknowledges that coaching does not involve the diagnosis or treatment of mental disorders as defined by the American Psychiatric Association and that coaching is not to be used as a substitute for counseling, psychotherapy, psychoanalysis, mental health care, substance abuse treatment, or other professional advice by legal, medical or other qualified professionals and that it is the Client’s exclusive responsibility to seek such independent professional guidance as needed. If Client is currently under the care of a mental health professional, Client should promptly inform the mental health care provider of the nature and extent of the coaching relationship agreed upon by the Client and the Coach.",
        },
      ],
    },
    {
      id: "coaching-services",
      heading: "COACHING SERVICES",
      blocks: [
        {
          type: "p",
          text: "Coach agrees to provide the proposed coaching calls and coaching services to Client, subject to the terms and conditions of this Agreement. Coach agrees to devote as much time, attention, and energy as necessary to achieve the following (collectively, “Coaching”):",
        },
        {
          type: "list",
          items: [
            [
              "Coaching Packages available are listed on ",
              { text: WORK_WITH_ME_URL, href: "/work-with-me", bold: true },
            ],
          ],
        },
        {
          type: "p",
          text: "Coach has full discretion in Coaching but shall not engage in any services which are not expressly set forth in this Agreement without the prior written permission from Client.",
        },
      ],
    },
    {
      id: "scheduling-and-cancellation-policy",
      heading: "SCHEDULING & CANCELLATION POLICY",
      blocks: [
        {
          type: "p",
          text: "Coach and Client will schedule all coaching sessions at mutually agreeable times. Coach will make reasonable efforts schedule all sessions as soon as able. Sessions must be booked within the time frame purchased.",
        },
        {
          type: "p",
          text: "Client acknowledges that unanticipated circumstances arise, and the timeline for delivering all sessions is not guaranteed. Coach reserves the right to cancel any coaching session by notifying the Client at least 24 hours prior to the scheduled session. Coach agrees to reschedule the cancelled session within 30 days of the originally scheduled session. If Coach is unable to reschedule the cancelled session within 30 days of the originally scheduled session, Client will be entitled to a refund of that session’s fee.",
        },
        {
          type: "p",
          text: "In the event Client needs to cancel or reschedule any session, Client agrees to provide 24 hours’ notice of cancellation in advance of such session. Client agrees that any unused calls by the end of agreement will be forfeited.",
        },
      ],
    },
    {
      id: "compensation",
      heading: "COMPENSATION",
      blocks: [
        {
          type: "p",
          text: "Client shall pay to Coach a monthly fee that is chosen on the checkout page or as agreed with coach or paid in full.",
        },
        {
          type: "p",
          text: "Coach acknowledges and agrees that payment as provided in this Section shall constitute full and final compensation for all Services and rights granted under this Agreement.",
        },
        {
          type: "p",
          text: "All payments under this Agreement are non-refundable. Client shall not be entitled to a refund for any reason, including but not limited to termination of this Agreement. Payment under this Agreement reserves Coach’s time and prevents someone else from benefiting from Coach’s services; as such, all funds paid shall be considered compensation for services rendered are not refundable.",
        },
        {
          type: "p",
          text: [
            { text: "Force Majeure.", bold: true },
            " Coach shall not be liable for delay or failure in the performance of its obligations under this Agreement if such delay or failure is caused by conditions beyond its reasonable control, including but not limited to, fire, flood, inclement weather, accident, earthquakes, governmental order, pandemic or epidemic, telecommunications line failures, electrical outages, network failures, acts of God, terrorism, civil commotion, or labor disputes.",
          ],
        },
      ],
    },
    {
      id: "confidentiality",
      heading: "CONFIDENTIALITY",
      blocks: [
        {
          type: "p",
          text: "The coaching relationship and any information that the Client shares with the Coach as part of this relationship is considered confidential (“Confidential Information”). Coach agrees not to disclose or make use of any Confidential Information, directly or indirectly, except for the sole benefit of Client, as necessary to perform the Coaching, without Client’s written consent. Coach will not disclose Client’s name as a reference without Client’s written consent. Coach shall not directly or indirectly disclose or make use of any Confidential Information after the term of this Agreement for any reason. Coach will use reasonable care in handling Client’s Confidential Information so that it does not enter the public domain. Coach will return all Confidential Information to Client upon termination of this Agreement.",
        },
        {
          type: "p",
          text: "Client acknowledges that the Coach-Client relationship is not considered a legally confidential relationship (like the medical and legal professions) and communications between Coach and Client are not subject to the protection of any legally recognized privilege.",
        },
        {
          type: "p",
          text: "Coach may disclose Confidential Information to the extent that: (i) it becomes publicly available or known by no fault of Coach; (ii) Client grants permission for such disclosure in writing; (iii) Coach obtains the information from a third party, without breach of any obligation to the Client; (iv) disclosure is required by any court or government agency; (v) Coach reasonably believes that there is an imminent or likely risk of danger or harm to the Client or others; or (vi) it involves illegal activity.",
        },
        {
          type: "p",
          text: "In receiving Coaching, Client will have the benefit of proprietary systems, strategies and techniques developed by Coach (“Coach’s Proprietary Information”). Client acknowledges that Coach’s business relies on Coach’s ability to provide such insights to various clients. Client agrees not to disclose Coach’s Proprietary Information to any third party, directly or indirectly, during the term of this Agreement or after it ends.",
        },
      ],
    },
    {
      id: "limitation-of-liability",
      heading: "LIMITATION OF LIABILITY",
      blocks: [
        {
          type: "p",
          text: "Except as expressly provided in this Agreement, Coach makes no guarantees, representations or warranties of any kind or nature, express or implied with respect to the Coaching. In no event shall Coach be liable to Client for any indirect, consequential or special damages. Coach’s entire liability for any breach of this Agreement, and Client’s sole remedy, shall be limited to the lesser of the total Contract Price or the amount actually paid by Client to Coach under this Agreement.",
        },
        {
          type: "p",
          text: "Coach is not responsible for any technical difficulties with hardware, software, connectivity, or other technological aspects of electronic coaching sessions, and does not guarantee that the conferencing software, or group coaching sessions will be free from technical problems, available at all times, or work as expected.",
        },
      ],
    },
    {
      id: "miscellaneous-terms",
      heading: "MISCELLANEOUS TERMS",
      blocks: [
        {
          type: "p",
          text: [
            { text: "Waiver.", bold: true },
            " The waiver by either Party of a breach or default of any of the provisions of this Agreement by the other party shall not be construed as a waiver of any succeeding breach or default of the same or any other provision of this Agreement, nor shall any delay or omission on the part of either party to exercise or avail itself of any right, power or privilege that it has or may have hereunder operate as a waiver of any breach or default.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Severability.", bold: true },
            " If any provision or portion of this Agreement is held by a court of competent jurisdiction to be illegal, invalid, or unenforceable, the remaining provisions or portions shall remain in full force and effect, and the invalid provision or part shall be deleted as narrowly as possible to render this Agreement valid and enforceable. If the scope of any provision of this Agreement is determined to be too broad to permit enforcement to its maximum extent, such provision shall be enforced to the maximum extent permitted by law.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Governing Law.", bold: true },
            " This Agreement will be governed by and interpreted in accordance with the laws of the State of North Dakota without giving effect to its principles of conflicts of law.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Assignment.", bold: true },
            " Neither Party may assign, transfer, subcontract or delegate any right or obligation under this Agreement without the prior written consent of the other party.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Notices.", bold: true },
            " All notices shall be in writing and deemed effective when received by either electronic mail or paper mail at the address of the party to be notified provided in the introductory provision of this Agreement. Either party may change the address to which notices are to be sent by providing written notice to the other party as provided for in this section.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Section Headings.", bold: true },
            " Section headings are inserted for convenience only and shall not be used in any way to construe the terms of this Agreement.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Entire Agreement.", bold: true },
            " This Agreement shall be deemed to express, embody and supersede all previous statements, promises, inducements, understandings, agreements, or commitments, whether written or oral, between the parties with respect to the subject matter hereof and to fully and finally set forth the entire agreement between the parties. No previous statement, promise, inducement, understanding, or agreement made by any party hereto that is not contained herein shall be binding or valid.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Amendments.", bold: true },
            " This Agreement may be modified only by a written amendment signed by authorized representatives of both Parties.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "No Insurance.", bold: true },
            " As Coach is an independent Contractor, Client will not be required to provide Coach with any employee, individual or group insurance policy or any other kind of insurance coverage including, but not limited to, workers compensation, general or public liability, or errors and omissions insurance.",
          ],
        },
        {
          type: "p",
          text: [
            { text: "Counterparts.", bold: true },
            " This Agreement may be executed in two or more counterparts, each of which shall be deemed an original, but all of which together shall constitute one and the same instrument.",
          ],
        },
      ],
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   Continuing-education policies — two published versions
   ══════════════════════════════════════════════════════════════════════════

   Kajabi carries two different documents under one heading:
     /ceu-terms-boss-clinician            — Nevada State Board of MFT/LPC and
                                            Social Work, 7-day refund window,
                                            "Updated 11/14/2025".
     /continuing-education-boss-clinician — NBCC, 14-day refund window, the
                                            extra ASWB paragraph, undated.
   Both are reproduced as published; the shared clauses are built once below. */

const CE_INTRO_SOCIAL_WORK =
  "The social work consultant will be involved in the resolution of any complaints about the speaker or course content, and the resolution of any complaints that escalate to a formal grievance for social workers. The social work consultant is Yvette Howard Email is ";

const CE_CONFIDENTIALITY_PARTICIPANT: LegalClause = {
  id: "confidentiality-of-participant-information",
  heading: "Confidentiality of Participant Information:",
  blocks: [
    {
      type: "p",
      text: "The CE Provider will protect participant information received during registration, such as name, address, telephone number, email address, and financial information. If the CE Provider plans to offer credit for a home study program that includes a recorded webinar or in-person training, the CE Provider must ensure that participants are not identifiable through name, image, or any other means or the CE Provider must have proper permission from the participant.",
    },
  ],
};

const CE_GRIEVANCE_LEAD =
  "While Boss Clinician, LLC goes to great lengths to assure fair treatment for all participants and attempts to anticipate problems, there will be occasional issues which come to the attention of the continuing education staff which require intervention and/or action on the part of Boss Clinician, LLC. This procedural description serves as a guideline for handling such grievances.";

const CE_GRIEVANCE_NO_GUARANTEE =
  "Although we do not guarantee a particular outcome, Boss Clinician, LLC will consider the complaint, make any necessary decisions, and respond within a reasonable time.";

const CE_GRIEVANCE_SPEAKER =
  "If the grievance concerns a speaker, the content presented by the speaker, or the style of presentation, the individual filing the grievance will be asked to put his/her comments in written format. The CE Provider will then pass on the comments to the speaker, assuring the confidentiality of the grieved individual. If the CE Provider is also the presenter, please send the complaint to ";

const CE_GRIEVANCE_WORKSHOP =
  "If the grievance concerns a live workshop offering, its content, level of presentation, or the facilities in which the workshop was offered, the CE Provider will mediate and will be the final arbitrator. If the participant requests action, the CE Provider will consider the complaint, make any necessary decisions, and respond within a reasonable time.";

const CE_GRIEVANCE_ORG =
  "If the grievance concerns [name of organization] in a specific regard, please contact the CE Provider to resolve.";

const CE_CONCERN =
  "If a participant or potential participant would like to express a concern about Boss Clinician, LLC or a continuing education program provided by Boss Clinician, LLC, the individual may contact the CE Provider by email at ";

const CE_CONFIDENTIALITY_COMPLAINANT =
  "All possible care will be taken to uphold the confidentiality of the complainant. The Advisory Board will formulate a response to the complaint and recommend action if necessary, which will be conveyed directly to the complainant. For example, a grievance concerning a speaker will be conveyed to that speaker and also to those planning future educational programs. A grievance concerning a workshop offering, content, facilities, or costs may be resolved by modifications to future offerings, and/or by providing an alternative training opportunity, should that be possible.";

const CE_RECORDS_LEAD =
  "Confidential records of all grievances, the process of resolving the grievance, and the outcome will be kept in locked files of the Owner & Training Development Officer. All applicable written complaints/grievances and the CE Program’s written response to the complaints/grievances are also reported to ";

/* The refund address is printed as …practices.com on Kajabi; its mailto went to
   …practice.com. The printed address is the one used here — it is the domain
   every other address on these pages uses. */
const SUPPORT_EMAIL = "support@profitableprivatepractices.com";

function ceFeesClause(refundDays: number): LegalClause {
  return {
    id: "fees-refunds-and-cancellation",
    heading: "Fees, Refunds, and Cancellation",
    blocks: [
      {
        type: "p",
        text: "Webinar/ On-demand courses: Due to the digital nature of on-demand courses, refunds are not available, as once purchased, participants have immediate access to all materials.",
      },
      {
        type: "p",
        text: [
          "If you are unable to access the webinar/on-demand course due to internet issues, refunds are not available. If you are not satisfied with a course, please send your request for consideration of a refund explaining in detail your concerns to ",
          { text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
          " and we will review and make our decision based on other participant completion comments.",
        ],
      },
      { type: "subhead", text: "Live Online or In-Person Trainings:" },
      {
        type: "p",
        text: `You may request a refund up to ${refundDays} days prior to the training. After that time, refunds will not be available.`,
      },
    ],
  };
}

const CE_DISCLOSURE: LegalClause = {
  id: "disclosure-or-use-of-client-information",
  heading: "Disclosure or Use of Client Information in a CE Program.",
  blocks: [
    {
      type: "p",
      text: "Client information must not be disclosed by a presenter or participant unless proper informed consent has been obtained for use in a continuing education program. Composites of real-life case examples are commonly used in continuing education programs to provide examples or facilitate role plays or discussion while maintaining confidentiality.",
    },
  ],
};

const CE_ADA: LegalClause = {
  id: "ada-accommodations",
  heading: "ADA accommodations",
  blocks: [
    {
      type: "p",
      text: [
        "ADA accommodations will be made in accordance with the law; please indicate your special needs when you register by sending an email to ",
        { text: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
        ".",
      ],
    },
  ],
};

/** /ceu-terms-boss-clinician — the Nevada-board version. Addresses are links on this one. */
export const ceuTerms: KajabiLegalDoc = {
  seo: {
    title: "CEU Terms Boss Clinician | Legal Agreement",
    description:
      "Please read our Terms of Use for CEUs for important information regarding the rules and guidelines for attending CEUs. By using the site, you agree to comply with these terms.",
    image: LEGAL_SHARE_IMAGE,
  },
  eyebrow: "Legal",
  title: "Continuing Education Program Policies",
  dateLine: "Updated 11/14/2025",
  clauses: [
    {
      id: "preamble",
      heading: null,
      blocks: [
        {
          type: "p",
          text: [
            { text: "Boss Clinician, LLC", bold: true },
            " is fully committed to conducting all activities in strict conformance with Nevada State Board of MFT/LPC and Social Work.  Boss Clinician, LLC will comply with all legal and ethical responsibilities to be non-discriminatory in promotional activities, program content and in the treatment of program participants. The monitoring and assessment of compliance with these standards will be the responsibility of the CE Provider.",
          ],
        },
      ],
    },
    CE_CONFIDENTIALITY_PARTICIPANT,
    {
      id: "grievance-procedure",
      heading: "Grievance Procedure:",
      blocks: [
        { type: "p", text: CE_GRIEVANCE_LEAD },
        {
          type: "list",
          items: [
            [
              CE_CONCERN,
              {
                text: "yvette@profitableprivatepractice.com.",
                href: "mailto:yvette@profitableprivatepractice.com",
              },
            ],
            CE_GRIEVANCE_NO_GUARANTEE,
            [
              CE_GRIEVANCE_SPEAKER,
              {
                text: "admin@profitableprivatepractices.com",
                href: "mailto:admin@profitableprivatepractices.com",
              },
            ],
            CE_GRIEVANCE_WORKSHOP,
            CE_GRIEVANCE_ORG,
            [
              CE_INTRO_SOCIAL_WORK,
              {
                text: "yvette@profitableprivatepractices.com",
                href: "mailto:yvette@profitableprivatepractices.com",
              },
            ],
          ],
        },
      ],
    },
    {
      id: "confidentiality",
      heading: "Confidentiality:",
      blocks: [
        { type: "p", text: CE_CONFIDENTIALITY_COMPLAINANT },
        { type: "p", text: `${CE_RECORDS_LEAD}the Nevada State Board of MFT/LPC.` },
        {
          type: "p",
          text: "Please contact the CE Provider to submit a complaint or if you have additional questions.",
        },
      ],
    },
    ceFeesClause(7),
    CE_DISCLOSURE,
    CE_ADA,
  ],
};

/** /continuing-education-boss-clinician — the NBCC version. Addresses are plain text in its list. */
export const continuingEducation: KajabiLegalDoc = {
  seo: {
    title: "Continuing Education Policy for Boss Clinician | Legal Agreement",
    description:
      "Please read our Terms of Use for important information regarding the rules and guidelines for using the Boss Clinician website. By using the site, you agree to comply with these terms.",
    image: LEGAL_SHARE_IMAGE,
  },
  eyebrow: "Legal",
  title: "Continuing Education Program Policies",
  clauses: [
    {
      id: "preamble",
      heading: null,
      blocks: [
        {
          type: "p",
          text: [
            { text: "Boss Clinician, LLC", bold: true },
            " is fully committed to conducting all activities in strict conformance with NBCC Boss Clinician, LLC will comply with all legal and ethical responsibilities to be non-discriminatory in promotional activities, program content and in the treatment of program participants. The monitoring and assessment of compliance with these standards will be the responsibility of the CE Provider.",
          ],
        },
      ],
    },
    CE_CONFIDENTIALITY_PARTICIPANT,
    {
      id: "grievance-procedure",
      heading: "Grievance Procedure:",
      blocks: [
        { type: "p", text: CE_GRIEVANCE_LEAD },
        {
          type: "list",
          items: [
            `${CE_CONCERN}yvette@profitableprivatepractice.com.`,
            CE_GRIEVANCE_NO_GUARANTEE,
            `${CE_GRIEVANCE_SPEAKER}admin@profitableprivatepractices.com`,
            CE_GRIEVANCE_WORKSHOP,
            CE_GRIEVANCE_ORG,
            `${CE_INTRO_SOCIAL_WORK}yvette@profitableprivatepractices.com`,
            "ASWB: Boss Clinician has an advisory committee to mediate complaints escalated to formal grievances. The advisory committee will be involved in the resolution of all grievances brought by social workers.",
          ],
        },
      ],
    },
    {
      id: "confidentiality",
      heading: "Confidentiality:",
      blocks: [
        { type: "p", text: CE_CONFIDENTIALITY_COMPLAINANT },
        { type: "p", text: `${CE_RECORDS_LEAD}NBCC.` },
        {
          type: "p",
          text: "Please contact the CE Provider to submit a complaint or if you have additional questions.",
        },
      ],
    },
    ceFeesClause(14),
    CE_DISCLOSURE,
    CE_ADA,
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
   /retreatagreement — Release. Restore. Reconnect. (Bali, June 2027)
   ══════════════════════════════════════════════════════════════════════════ */

const RETREATS_EMAIL = "retreats@bossclinician.com";
const RETREATS_MAILTO: LegalSpan = { text: RETREATS_EMAIL, href: `mailto:${RETREATS_EMAIL}` };

export const retreatAgreement: KajabiLegalDoc = {
  seo: {
    title: "Retreat T&A",
    description:
      "Terms of Service & Retreat Agreement for Release. Restore. Reconnect., the Boss Clinician luxury healing retreat in Ubud, Bali, Indonesia, June 15–20, 2027.",
  },
  eyebrow: "Boss Clinician, LLC",
  title: "Terms of Service",
  titleAccent: "& Retreat Agreement",
  lede: "Release. Restore. Reconnect.  ·  Bali, Indonesia  ·  June 15–20, 2027",
  dateLine: "Effective Date: June 1, 2026",
  clauses: [
    {
      id: "preamble",
      heading: null,
      blocks: [
        {
          type: "p",
          text: [
            "These Terms of Service govern your participation in the ",
            { text: "Release. Restore. Reconnect.", bold: true },
            " luxury healing retreat hosted by Boss Clinician, LLC in Ubud, Bali, Indonesia, June 15–20, 2027. By submitting a deposit or completing any payment, you confirm that you have read, understood, and agreed to all terms below. This agreement is legally binding.",
          ],
        },
      ],
    },
    {
      id: "about-the-retreat",
      label: "Section 01",
      heading: "About the Retreat",
      blocks: [
        {
          type: "p",
          text: "Release. Restore. Reconnect. is a five-day luxury healing retreat designed exclusively for women in healthcare and wellness. The retreat takes place June 15–20, 2027 at a private villa estate in Ubud, Bali, Indonesia and is hosted by Yvette Howard, LCSW, founder of Boss Clinician, LLC.",
        },
        {
          type: "p",
          text: "This retreat is limited to twelve (12) women. Activities and experiences may be led by Yvette Howard or guest facilitators and may include guided wellness sessions, cultural excursions, and curated group experiences. Most activities take place at the private villa, with select experiences off-site. The specific schedule is subject to adjustment at the discretion of Boss Clinician, LLC.",
        },
      ],
    },
    {
      id: "whats-included",
      label: "Section 02",
      heading: "What’s Included",
      blocks: [
        { type: "p", text: "Your retreat investment includes the following:" },
        {
          type: "list",
          items: [
            "Five nights’ accommodation at a private 12-bedroom villa estate in Ubud, Bali (room type based on package selected)",
            "Group luxury airport transportation to and from I Gusti Ngurah Rai International Airport (DPS) on official arrival and departure days at designated shuttle times",
            "All meals prepared daily by a private villa chef, including breakfast, brunch, and dinner, plus outside villa meals as scheduled",
            "Wellness experiences: sound bath, breathwork session, Balinese massage, and flower bath",
            "Curated group activities: temple tour, fire show, beach day, photo day, shared storytelling, and dancing",
            "Pre-trip group call with Yvette Howard prior to the retreat date",
            "All retreat materials and essentials",
            "Personalized luxury welcome gift bag",
          ],
        },
      ],
    },
    {
      id: "whats-not-included",
      label: "Section 03",
      heading: "What’s Not Included",
      blocks: [
        {
          type: "p",
          text: "The following are not included in your retreat investment and are the sole responsibility of the participant:",
        },
        {
          type: "list",
          items: [
            "Airfare to and from I Gusti Ngurah Rai International Airport (DPS), Bali, Indonesia",
            "Travel insurance (strongly recommended — see Section 7)",
            "Passport or visa fees",
            "Airport transfers outside of designated shuttle times",
            "Personal spending outside of included retreat activities",
            "Additional spa services or excursions not listed in the official retreat itinerary",
          ],
        },
      ],
    },
    {
      id: "investment-and-payment-terms",
      label: "Section 04",
      heading: "Investment & Payment Terms",
      blocks: [
        { type: "p", text: "Two room options are available. All prices are per person." },
        {
          type: "pricing",
          options: [
            {
              eyebrow: "Private Room",
              name: "Private King Suite",
              price: "$5,500",
              note: ["$500 deposit · remaining balance", "due in full by June 8, 2027"],
            },
            {
              eyebrow: "Shared Room",
              name: "Shared Luxury Room",
              price: "$4,500",
              per: "per person",
              note: ["$500 deposit · remaining balance", "due in full by June 8, 2027"],
            },
          ],
        },
        {
          type: "p",
          tone: "callout",
          text: [
            { text: "Important:", bold: true },
            " Your $500 deposit is non-refundable and is not a free trial. Your card will be charged $500 at the time of registration. This payment reserves your spot in the retreat.",
          ],
        },
        {
          type: "list",
          items: [
            [
              "A non-refundable deposit of ",
              { text: "$500", bold: true },
              " is required to confirm and reserve your spot. Submitting your deposit constitutes acceptance of these Terms of Service.",
            ],
            "The remaining balance may be paid in full or through installment payments at your own pace, provided all payments are completed by June 8, 2027.",
            "Monthly payments are processed automatically on the same date each month following your deposit.",
            "Failure to maintain your automatic payment schedule may result in forfeiture of your spot and all payments made to date, without refund.",
            [
              { text: "All payments must be completed in full by June 8, 2027", bold: true },
              " — one week before the retreat begins on June 15, 2027. Any outstanding balance not paid by this date will result in automatic forfeiture of your spot and all payments made to date, with no refund issued.",
            ],
            [
              "If you require a one-time change to your payment date within the same calendar month, contact ",
              RETREATS_MAILTO,
              " for approval prior to your scheduled payment date.",
            ],
          ],
        },
      ],
    },
    {
      id: "non-refundable-deposit-and-payments",
      label: "Section 05",
      heading: "Non-Refundable Deposit & Payments",
      blocks: [
        {
          type: "p",
          text: [
            {
              text: "All payments, including the deposit and all installments, are non-refundable under any circumstances.",
              bold: true,
            },
            " By submitting payment, you acknowledge and accept this policy in full.",
          ],
        },
        {
          type: "p",
          text: "This policy exists to protect the integrity of the retreat and the commitments made to vendors, villa partners, and service providers on your behalf. All bookings and contracts are executed based on confirmed participant numbers.",
        },
        {
          type: "list",
          items: [
            "The $500 deposit is always non-refundable, regardless of the reason for cancellation.",
            "All subsequent installment payments are non-refundable once processed.",
            "If you cancel with all payments current, you may apply funds paid to date — excluding the non-refundable deposit — as a credit toward a future Boss Clinician retreat within twelve (12) months of cancellation, subject to availability.",
            "Credits expire twelve (12) months from the date of cancellation and have no cash value.",
            "Failure to make a payment within the scheduled calendar month will result in automatic forfeiture of your spot and all payments made. No credit will be issued in this circumstance.",
            [
              { text: "Final payment deadline: June 8, 2027.", bold: true },
              " All balances must be paid in full one week before the retreat begins. Any participant with an outstanding balance after this date will be removed from the retreat with no refund or credit issued.",
            ],
            "Force majeure events — including but not limited to natural disasters, weather events, political unrest, government travel restrictions, or pandemics — will not result in refunds. Travel insurance is required to protect against these circumstances.",
          ],
        },
      ],
    },
    {
      id: "cancellation-by-boss-clinician",
      label: "Section 06",
      heading: "Cancellation by Boss Clinician, LLC",
      blocks: [
        {
          type: "p",
          text: "In the unlikely event that Boss Clinician, LLC must cancel or significantly reschedule the retreat due to circumstances within our control, participants will be offered either:",
        },
        {
          type: "list",
          items: [
            "A full credit toward a rescheduled or future retreat of equal value, or",
            "A refund of payments made, excluding any third-party fees already incurred on your behalf",
          ],
        },
        {
          type: "p",
          text: "Boss Clinician, LLC is not responsible for any additional costs incurred by participants, including airfare, travel insurance, visa fees, or personal expenses, in the event of a cancellation or schedule change.",
        },
      ],
    },
    {
      id: "travel-insurance",
      label: "Section 07",
      heading: "Travel Insurance",
      blocks: [
        {
          type: "p",
          text: [
            "Travel insurance is ",
            { text: "strongly recommended", bold: true },
            " for all participants. Because all payments are non-refundable, travel insurance is your primary financial protection in the event of unforeseen circumstances including illness, injury, flight cancellations, or force majeure events.",
          ],
        },
        { type: "p", text: "We recommend a comprehensive policy that includes:" },
        {
          type: "list",
          items: [
            "Trip cancellation and interruption coverage",
            "Emergency medical coverage and medical evacuation",
            "Coverage for wellness and adventure activities",
            "COVID-19 related illness or quarantine coverage (if applicable)",
            "Coverage for pre-existing conditions (if applicable)",
          ],
        },
        {
          type: "p",
          text: [
            "Boss Clinician, LLC does not provide travel insurance and is not responsible for losses that would otherwise be covered by travel insurance. We strongly encourage you to purchase a policy at the time of your deposit. One provider we recommend is ",
            { text: "Trawick International", href: "https://trawickinternational.com/" },
            " — visit ",
            { text: "trawickinternational.com", bold: true },
            " to explore coverage options.",
          ],
        },
      ],
    },
    {
      id: "lodging-and-roommates",
      label: "Section 08",
      heading: "Lodging & Roommates",
      blocks: [
        {
          type: "list",
          items: [
            [
              { text: "Private King Suite", bold: true },
              " includes a private bedroom with a versatile king bed and a private en suite bathroom.",
            ],
            [
              { text: "Shared Luxury Room", bold: true },
              " includes a private bedroom with two single beds and an en suite bathroom, shared with one other retreat participant. Each guest in a Shared Luxury Room purchases their own spot independently at $4,500 per person.",
            ],
            "If you select the Shared Luxury Room without naming a roommate preference, one will be thoughtfully assigned by Boss Clinician, LLC.",
            "The retreat property is a private villa estate in Ubud, Bali. The specific property address will be shared with confirmed participants prior to departure. The property is subject to change only in extenuating circumstances, in which case a comparable alternative will be arranged.",
          ],
        },
      ],
    },
    {
      id: "transportation",
      label: "Section 09",
      heading: "Transportation",
      blocks: [
        {
          type: "p",
          text: "Group luxury shuttle transportation will be provided between I Gusti Ngurah Rai International Airport (DPS) and the retreat villa at designated times on the official arrival day (June 15, 2027) and departure day (June 20, 2027).",
        },
        {
          type: "p",
          text: "If your flight does not align with the designated shuttle times, you are solely responsible for arranging and funding your own transportation to and from the villa. Boss Clinician, LLC does not provide accommodations or transportation before or after the official retreat dates.",
        },
      ],
    },
    {
      id: "health-and-safety",
      label: "Section 10",
      heading: "Health & Safety",
      blocks: [
        {
          type: "list",
          items: [
            "If you develop symptoms of a contagious illness before or during the retreat, you may be asked to isolate or depart the property at your own expense.",
            "You are solely responsible for all costs related to illness, medical care, isolation, or early departure.",
            "You agree to comply with all applicable health and safety protocols from the CDC, Indonesian health authorities, and Boss Clinician retreat staff.",
            "Boss Clinician, LLC reserves the right to modify, substitute, or cancel specific activities in the interest of participant health, safety, or wellbeing without issuing a refund for those activities.",
            "You represent that you are in adequate physical and mental health to participate in the retreat activities described. You accept full responsibility for your own health and wellness during travel and participation.",
          ],
        },
      ],
    },
    {
      id: "accident-waiver-and-release-of-liability",
      label: "Section 11",
      heading: "Accident Waiver & Release of Liability",
      blocks: [
        {
          type: "p",
          text: "By submitting payment and participating in the retreat, you acknowledge and voluntarily assume all risks associated with international travel and retreat activities, including those provided by third-party vendors and service providers.",
        },
        {
          type: "p",
          text: "You hereby release Boss Clinician, LLC, its owner, staff, contractors, facilitators, and partners from any and all liability for injury, illness, loss, theft, property damage, or any other harm incurred before, during, or after the retreat, whether or not caused by the negligence of Boss Clinician, LLC.",
        },
        {
          type: "p",
          text: "You agree to hold harmless and indemnify Boss Clinician, LLC for any claims, damages, losses, or expenses, including reasonable legal fees, arising from or related to your participation in the retreat.",
        },
      ],
    },
    {
      id: "photo-and-media-release",
      label: "Section 12",
      heading: "Photo & Media Release",
      blocks: [
        {
          type: "p",
          text: "By attending the retreat, you grant Boss Clinician, LLC the irrevocable right to photograph, video, and record you during retreat activities and to use your name, voice, image, and likeness for marketing, promotional, and educational purposes. This includes but is not limited to use on social media platforms, the Boss Clinician website, email marketing, and future retreat promotions.",
        },
        {
          type: "p",
          text: [
            "If you wish to opt out of photo and media use, you must notify Boss Clinician, LLC in writing at ",
            RETREATS_MAILTO,
            " no later than 30 days prior to the retreat start date. Withdrawal of consent is not retroactive and does not apply to content already published.",
          ],
        },
      ],
    },
    {
      id: "code-of-conduct",
      label: "Section 13",
      heading: "Code of Conduct",
      blocks: [
        {
          type: "p",
          text: "The Release. Restore. Reconnect. retreat is an intentional space built on mutual respect, sisterhood, and care. All participants are expected to honor that space.",
        },
        {
          type: "list",
          items: [
            "Treat all participants, facilitators, villa staff, and vendors with dignity and respect at all times.",
            "Refrain from behavior that disrupts, harms, or diminishes the experience of other participants.",
            "Honor the privacy of other participants — what is shared in the retreat stays in the retreat.",
          ],
        },
        {
          type: "p",
          text: "Boss Clinician, LLC reserves the right to remove any participant from the retreat at any time for conduct that is disruptive, harmful, or inconsistent with the retreat’s values. In such a case, no refund will be issued.",
        },
      ],
    },
    {
      id: "governing-law-and-disputes",
      label: "Section 14",
      heading: "Governing Law & Disputes",
      blocks: [
        {
          type: "p",
          text: "These Terms of Service shall be governed by and construed in accordance with the laws of the State of Nevada, United States, without regard to its conflict of law provisions. Any dispute arising out of or relating to these terms or your participation in the retreat shall first be attempted to be resolved through good-faith negotiation. If unresolved, disputes shall be submitted to binding arbitration in Nevada.",
        },
        {
          type: "p",
          text: "By submitting payment you waive any right to a jury trial or class action proceeding related to this agreement.",
        },
      ],
    },
    {
      id: "modifications-to-these-terms",
      label: "Section 15",
      heading: "Modifications to These Terms",
      blocks: [
        {
          type: "p",
          text: "Boss Clinician, LLC reserves the right to update or modify these Terms of Service at any time. Participants will be notified of material changes via email. Continued participation in the retreat following notification of changes constitutes acceptance of the updated terms.",
        },
        {
          type: "p",
          text: [
            "The most current version of these Terms of Service will always be available at ",
            { text: "bossclinician.callsphere.site/retreatagreement", href: "/retreatagreement" },
            ".",
          ],
        },
      ],
    },
    {
      id: "entire-agreement",
      label: "Section 16",
      heading: "Entire Agreement",
      blocks: [
        {
          type: "p",
          text: "These Terms of Service, together with your payment confirmation, constitute the entire agreement between you and Boss Clinician, LLC with respect to your participation in the Release. Restore. Reconnect. retreat. They supersede all prior communications, representations, or agreements, whether written or oral.",
        },
        {
          type: "p",
          text: "If any provision of these terms is found to be unenforceable, the remaining provisions will continue in full force and effect.",
        },
      ],
    },
  ],
  contact: {
    heading: "Questions About These Terms?",
    body: "We are here to help. Reach out before completing your registration.",
    email: RETREATS_EMAIL,
    lines: [
      "Boss Clinician, LLC  ·  bossclinician.com  ·  @bossclinician",
      "© 2026 Boss Clinician, LLC. All rights reserved.  ·  Release. Restore. Reconnect.  ·  Bali, June 15–20, 2027",
    ],
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   /terms-of-use — the April 2026 Terms of Use
   ══════════════════════════════════════════════════════════════════════════

   Not the same document as pages/legal/Terms.tsx (which carries the older
   5/19/2025 site terms). Kajabi's /terms-of-use was replaced on 04/01/2026 with
   this 18-section membership agreement. */

const SUPPORT_BC = "support@bossclinician.com";
const SUPPORT_BC_MAILTO: LegalSpan = { text: SUPPORT_BC, href: `mailto:${SUPPORT_BC}` };

export const termsOfUse: KajabiLegalDoc = {
  seo: {
    title: "Terms of Use for Boss Clinician | Legal Agreement",
    description:
      "Please read our Terms of Use for important information regarding the rules and guidelines for using the Boss Clinician website. By using the site, you agree to comply with these terms.",
    image: LEGAL_SHARE_IMAGE,
  },
  eyebrow: "BOSS CLINICIAN",
  title: "Terms of Use",
  lede: "Boss Clinician, LLC  |  Yvette Howard, LCSW  |  bossclinician.com",
  dateLine: "Effective Date: 04/01/2026",
  clauses: [
    {
      id: "acceptance-of-terms",
      heading: "1. Acceptance of Terms",
      blocks: [
        {
          type: "p",
          text: 'These Terms of Use ("Terms") govern your access to and use of bossclinician.com and all programs, memberships, courses, workbooks, community spaces, live sessions, and related content offered by Boss Clinician, LLC ("Boss Clinician," "we," "us," or "our"), including the Boss Clinician Club, the Boss Clinician Lounge, and the Boss Clinician Boardroom (collectively, the "Services").',
        },
        {
          type: "p",
          text: "By enrolling in any Service, creating an account, or otherwise accessing our content, you agree to be bound by these Terms. If you do not agree to these Terms, do not enroll in or use the Services.",
        },
      ],
    },
    {
      id: "description-of-services",
      heading: "2. Description of Services",
      blocks: [
        {
          type: "p",
          text: "Boss Clinician provides business education, strategy, coaching, and community support for licensed mental health clinicians building and growing private practices. Our current offerings include:",
        },
        {
          type: "list",
          items: [
            "The Boss Clinician Club, a 6-month coaching program built around The Boss Move curriculum for clinicians starting or rebuilding a private practice.",
            "The Boss Clinician Lounge, a membership built around The Practice Elevation curriculum, monthly strategy sessions, and community support for clinicians who are fully booked and ready to restructure their practice.",
            "The Boss Clinician Boardroom, an annual mastermind for group practice owners, including full library access to Boss Clinician content and Boardroom Playbooks.",
          ],
        },
        {
          type: "p",
          text: "Boss Clinician reserves the right to modify, add, retire, or restructure any Service, course, or membership tier at any time. Where a change materially affects an active member's access or pricing, we will provide reasonable notice.",
        },
      ],
    },
    {
      id: "eligibility",
      heading: "3. Eligibility",
      blocks: [
        {
          type: "p",
          text: "The Services are intended for licensed or license-track mental health clinicians and related business professionals. You must be at least 18 years old and capable of entering into a binding agreement to use the Services. You are responsible for ensuring your own compliance with the licensing, continuing education, supervision, and ethical requirements of your profession and jurisdiction.",
        },
      ],
    },
    {
      id: "membership-enrollment-billing-and-renewal",
      heading: "4. Membership Enrollment, Billing, and Renewal",
      blocks: [
        {
          type: "p",
          text: "Membership tiers may be billed monthly, on a fixed-term commitment (for example, a six-month term), annually, or as a one-time payment, as described on the applicable sales or checkout page at the time of your enrollment.",
        },
        {
          type: "list",
          items: [
            "Your payment method on file will be charged automatically on each billing date until your membership is cancelled in accordance with Section 5.",
            "If a fixed-term commitment is in place (such as a six-month Lounge term), your membership will automatically convert to month-to-month billing at the end of that term unless you cancel or upgrade before the renewal date.",
            "Prices are subject to change. If we change the price of your membership, we will provide notice before the change applies to your next billing cycle. Continued use of the Services after that notice constitutes acceptance of the new price.",
            "You are responsible for keeping your payment information current. A failed payment may result in a pause or loss of access until payment is resolved.",
          ],
        },
        {
          type: "p",
          tone: "note",
          text: "Founding or promotional rates apply only while the membership remains continuously active. If a membership is cancelled or lapses, re-enrollment is at the then-current published rate.",
        },
        {
          type: "p",
          tone: "note",
          text: "Where a program is sold as a payment plan (for example, six monthly payments), the payment plan is not a subscription: all scheduled payments are owed upon enrollment, and cancellation does not cancel remaining scheduled payments except as provided under an applicable guarantee.",
        },
      ],
    },
    {
      id: "cancellation",
      heading: "5. Cancellation",
      blocks: [
        {
          type: "p",
          text: [
            "You may cancel your membership at any time by submitting a cancellation request to ",
            SUPPORT_BC_MAILTO,
            " or through the cancellation option in your member portal, if available.",
          ],
        },
        {
          type: "list",
          items: [
            "Cancellation stops future billing. It does not entitle you to a refund of any payment already made, except as described in Section 6.",
            "If you are within a fixed-term commitment, cancellation will take effect at the end of that term unless otherwise stated on your enrollment page.",
            "Upon cancellation, your access to member content, community spaces, and live sessions ends at the close of your final paid billing period.",
          ],
        },
      ],
    },
    {
      id: "refund-policy",
      heading: "6. Refund Policy",
      blocks: [
        {
          type: "p",
          text: "Due to the digital nature of our Services and the instant access provided to course content, workbooks, and community spaces upon enrollment, all sales are final and non-refundable, except where a specific Service page states an alternative refund or guarantee policy at the time of your enrollment.",
        },
        {
          type: "p",
          text: "Where a specific guarantee is offered for a given program (for example, an action-based guarantee tied to completed onboarding steps), the terms of that guarantee, including any eligibility requirements and request deadline, will be stated on the applicable sales page and control over this general policy for that program.",
        },
        {
          type: "p",
          text: [
            "For programs offering an action-based guarantee, refund eligibility requires completion of all stated onboarding and coursework criteria and submission of completed work to ",
            SUPPORT_BC_MAILTO,
            " within the stated window. No refunds are provided after the guarantee window, or for change of mind or non-participation.",
          ],
        },
      ],
    },
    {
      id: "intellectual-property",
      heading: "7. Intellectual Property",
      blocks: [
        {
          type: "p",
          text: 'All content provided through the Services, including but not limited to workbooks, curriculum, videos, templates, scripts, trackers, the BOSS Blueprint framework, and all other original materials (collectively, "Materials"), is the intellectual property of Boss Clinician, LLC and is protected by copyright and other applicable law.',
        },
        {
          type: "list",
          items: [
            "Your enrollment grants you a limited, non-transferable, non-exclusive license to access and use the Materials for your own individual professional development and practice.",
            "You may not copy, share, resell, distribute, publicly post, or create derivative works from the Materials, in whole or in part, without our prior written consent.",
            "You may not use the Materials to create a competing product, course, or membership.",
            "Violation of this section may result in immediate termination of your access without refund, in addition to any other remedies available to us.",
          ],
        },
      ],
    },
    {
      id: "community-conduct",
      heading: "8. Community Conduct",
      blocks: [
        {
          type: "p",
          text: "Our community spaces, including any private group, forum, or hot seat session, exist to support clinicians in a respectful, professional environment. By participating, you agree to:",
        },
        {
          type: "list",
          items: [
            "Engage respectfully with other members and with Boss Clinician staff.",
            "Refrain from harassment, discrimination, solicitation of other members for outside products or services, or sharing of Materials outside the community.",
            "Understand that Boss Clinician may, at its sole discretion, remove any member from a community space for conduct that violates this section, without refund, if the conduct is severe or repeated after a warning.",
          ],
        },
      ],
    },
    {
      id: "confidentiality",
      heading: "9. Confidentiality",
      blocks: [
        {
          type: "p",
          text: "Live coaching calls, hot seats, and community discussions may involve members sharing details about their own practice, clients (in de-identified form), finances, or business challenges. By participating, you agree to keep confidential any identifying or sensitive information shared by another member during a coaching call, hot seat, or community discussion, and not to disclose it outside that space.",
        },
        {
          type: "p",
          text: "This confidentiality obligation applies to fellow members and does not create a clinical or supervisory relationship between you and Boss Clinician, nor between you and any other member.",
        },
      ],
    },
    {
      id: "vip-submission-terms",
      heading: "10. VIP Submission Terms",
      blocks: [
        {
          type: "p",
          text: "Where a membership tier includes VIP support (such as direct submission access for feedback or review), the following terms apply unless a specific Service page states otherwise:",
        },
        {
          type: "list",
          items: [
            "VIP members may submit one item per eligible category per month.",
            "Submissions follow the posted weekly rhythm (for example, submission by Monday with feedback returned by the following business day).",
            "VIP access does not include unlimited or on-demand 1:1 coaching, and does not create an ongoing consulting relationship beyond the scope described on the applicable Service page.",
          ],
        },
        {
          type: "p",
          text: "VIP monthly benefits do not roll over; an unused submission in any month is forfeited. Materials review submissions receive one complete recorded review per submission; revision cycles are not included. Where a tier includes a structured call series (such as scheduled strategy calls at defined intervals), those calls are limited to the number and timing described on the applicable Service page and do not renew or repeat beyond that series.",
        },
      ],
    },
    {
      id: "continuing-education-credits",
      heading: "11. Continuing Education Credits",
      blocks: [
        {
          type: "p",
          text: "Boss Clinician, LLC is an NBCC Approved Continuing Education Provider (ACEP). Select trainings within our curriculum carry NBCC-approved continuing education hours, and these trainings are clearly marked within the applicable membership.",
        },
        {
          type: "list",
          items: [
            "Continuing education hours are available only for the specific trainings designated as CEU-bearing at the time of your participation, not for the membership as a whole.",
            "You are solely responsible for confirming that any CEU hours earned through our Services satisfy the specific requirements of your licensing board, including any restrictions on repeated content, subject matter minimums, or provider approval in your jurisdiction.",
            "Boss Clinician makes no guarantee that CEU hours earned through our Services will be accepted by every licensing board, and we are not responsible for a licensing board's determination regarding your continuing education compliance.",
            "Certificates of completion, where applicable, will be issued according to the process described within the relevant course.",
          ],
        },
        {
          type: "p",
          text: [
            "Boss Clinician, LLC is approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Certificates of completion display the NBCC-approved program title, which may differ from the program's brand name used in marketing. Continuing education grievance, refund, and cancellation policies are available at ",
            // Kajabi prints a literal "[link]" placeholder here. It is kept, and
            // pointed at the NBCC continuing-education policy page it stands for.
            { text: "[link]", href: "/continuing-education-boss-clinician" },
            " or by request at ",
            SUPPORT_BC_MAILTO,
            ".",
          ],
        },
      ],
    },
    {
      id: "no-clinical-legal-tax-or-financial-advice",
      heading: "12. No Clinical, Legal, Tax, or Financial Advice",
      blocks: [
        {
          type: "p",
          text: "The Services provide business education, strategy, and coaching for private practice owners. They do not constitute clinical supervision, legal advice, tax advice, financial advice, or any other licensed professional service, and no professional relationship of that kind is created by your participation.",
        },
        {
          type: "p",
          text: "You should consult a qualified attorney, accountant, or other licensed professional before making legal, tax, financial, or licensure-related decisions for your practice.",
        },
      ],
    },
    {
      id: "earnings-disclaimer",
      heading: "13. Earnings Disclaimer",
      blocks: [
        {
          type: "p",
          text: "Boss Clinician provides education, strategy, and support designed to help you build a more profitable and sustainable private practice. We do not promise or guarantee any specific income result, growth outcome, or timeline.",
        },
        {
          type: "list",
          items: [
            "Any income examples, testimonials, or results referenced on our website or in our marketing reflect the experiences of specific individuals and are not typical or guaranteed outcomes.",
            "Your results depend on a number of factors outside our control, including your market, your effort, your implementation of the strategies taught, your existing practice conditions, and general economic conditions.",
            "Nothing in our marketing, curriculum, or coaching should be interpreted as a promise of a specific financial result.",
          ],
        },
      ],
    },
    {
      id: "limitation-of-liability",
      heading: "14. Limitation of Liability",
      blocks: [
        {
          type: "p",
          text: "To the fullest extent permitted by law, Boss Clinician, LLC, its owner, employees, and contractors will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of income, profits, goodwill, or data, arising out of or related to your use of the Services, even if we have been advised of the possibility of such damages.",
        },
        {
          type: "p",
          text: "Our total liability to you for any claim arising from the Services is limited to the amount you paid to Boss Clinician in the twelve months preceding the claim.",
        },
      ],
    },
    {
      id: "indemnification",
      heading: "15. Indemnification",
      blocks: [
        {
          type: "p",
          text: "You agree to indemnify and hold harmless Boss Clinician, LLC and its owner, employees, and contractors from any claim, demand, loss, or damage, including reasonable attorney fees, arising out of your use of the Services, your violation of these Terms, or your violation of any right of another person or entity, including another member.",
        },
      ],
    },
    {
      id: "modifications-to-these-terms",
      heading: "16. Modifications to These Terms",
      blocks: [
        {
          type: "p",
          text: "We may update these Terms from time to time. Where a change is material, we will provide reasonable notice, such as an email to your address on file or a notice within the member portal. Your continued use of the Services after a change takes effect constitutes your acceptance of the updated Terms.",
        },
      ],
    },
    {
      id: "governing-law",
      heading: "17. Governing Law",
      blocks: [
        {
          type: "p",
          text: "These Terms are governed by the laws of the State of Nevada, without regard to its conflict of law principles, unless otherwise required by applicable consumer protection law in your state of residence.",
        },
      ],
    },
    {
      id: "contact",
      heading: "18. Contact",
      blocks: [
        {
          type: "p",
          text: ["Questions about these Terms can be directed to ", SUPPORT_BC_MAILTO, "."],
        },
      ],
    },
  ],
};
