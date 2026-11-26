/**
 * NBCC's own wording, from the ACEP approval letter to Boss Clinician, LLC
 * (dated March 26, 2026, ACEP No. 7998). Directive A of that letter requires
 * this exact statement AND the ACEP logo on every page that advertises NBCC
 * credit, so both live here and are rendered together by <NbccApproval />.
 * Do not reword it.
 */
export const NBCC_APPROVAL_STATEMENT =
  "Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs.";

/** The official ACEP mark, extracted unaltered from the approval letter. */
export const NBCC_ACEP_LOGO = {
  src: "/images/nbcc/acep-logo.png",
  alt: "NBCC Approved Continuing Education Provider logo",
  width: 106,
  height: 107,
} as const;

/**
 * Course pages (rendered from the database by CourseDetail) that advertise
 * NBCC credit. Their certificates carry "NBCC ACEP No. 7998", so the sales
 * page must carry the statement and logo too.
 */
export const NBCC_COURSE_SLUGS: ReadonlySet<string> = new Set([
  "dos-and-donts-of-clinical-documentation-replay",
  "audit-proof-your-practice-on-demand",
  "profitable-private-practices-training",
]);
