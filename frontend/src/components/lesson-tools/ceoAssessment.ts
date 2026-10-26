export const CEO_ASSESSMENT_KEY = "boardroom-ceo-assessment";
export const CEO_ASSESSMENT_VERSION = "boardroom-ceo-v1";

/** Question order and wording are the owner's 25 October developer package. */
export const CEO_DOMAINS = [
  { id: "finance", name: "Financial Leadership", questions: ["How consistently do you review complete financial information before decisions?", "How clearly do you understand your practice’s operating profit and cash requirements?"], action: "Review the last three months of revenue, expenses, operating profit and liquidity before changing compensation or hiring." },
  { id: "team", name: "Team & Leadership", questions: ["How consistently do team members own their responsibilities without daily direction?", "How clearly do your leaders and staff understand performance expectations and accountability?"], action: "Clarify one leadership role, its decision rights, and an observable performance expectation." },
  { id: "operations", name: "Operational Independence", questions: ["How reliably do routine operations function without your personal involvement?", "How well documented and repeatable are your essential practice workflows?"], action: "Document one owner-dependent operational process and assign a responsible role." },
  { id: "growth", name: "Strategic Growth", questions: ["How consistently do you test growth opportunities against actual capacity and costs?", "How clearly are your next 12-month priorities and measurable milestones defined?"], action: "Choose one proposed growth opportunity and model its demand, capacity, costs and downside." },
  { id: "risk", name: "Risk & Protection", questions: ["How consistently do you review major compliance, staffing, and financial risks?", "How prepared is your practice to manage unexpected disruption or owner absence?"], action: "Identify the top two operational or financial risks and document a first response for each." },
  { id: "capacity", name: "CEO Capacity & Vision", questions: ["How protected is your schedule for executive planning rather than routine tasks?", "How confidently can you describe the business you are building beyond your own clinical work?"], action: "Protect one recurring executive strategy block and decide what routine activity to delegate or stop." },
] as const;

export const CEO_CHOICES = ["Rarely true / not established", "Sometimes true / inconsistent", "Usually true / mostly established", "Consistently true / documented and reviewed"] as const;
export type CeoDraft = { responses: number[] };
export type CeoDomainScore = { id: string; name: string; score: number };
export type CeoReport = {
  id: string; assessmentVersion: string; completedAt: string; quarter: string;
  responses: number[]; overallScore: number; domains: CeoDomainScore[];
  priorities: CeoDomainScore[]; firstAction: string;
};
export type CeoWorkspace = {
  reports: CeoReport[];
  links: { dashboard: { title: string; href: string } | null; plan: { title: string; href: string } | null };
  timezone: string;
};
export const emptyCeoDraft = (): CeoDraft => ({ responses: Array.from({ length: 12 }, () => 0) });
export function normaliseCeoDraft(value: unknown): CeoDraft {
  const input = value && typeof value === "object" && "responses" in value ? value.responses : null;
  return { responses: Array.from({ length: 12 }, (_, i) => {
    const v: unknown = Array.isArray(input) ? input[i] : undefined;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4 ? v : 0;
  }) };
}
export const completeCeoResponses = (responses: number[]) => responses.length === 12 && responses.every(v => Number.isInteger(v) && v >= 1 && v <= 4);

/** Only used for the read-only admin preview. Real results come from the server. */
export function previewCeoReport(responses: number[]): CeoReport | null {
  if (!completeCeoResponses(responses)) return null;
  const domains = CEO_DOMAINS.map((d, i) => ({ id: d.id, name: d.name, score: responses[i * 2] + responses[i * 2 + 1] }));
  const priorities = [...domains].sort((a, b) => a.score - b.score).slice(0, 3);
  return { id: "preview", assessmentVersion: CEO_ASSESSMENT_VERSION, completedAt: new Date().toISOString(), quarter: "Preview", responses: [...responses], overallScore: Math.round(responses.reduce((a, b) => a + b, 0) / 48 * 100), domains, priorities, firstAction: CEO_DOMAINS.find(d => d.id === priorities[0].id)!.action };
}

/** Use the latest actual baseline in an earlier quarter; never invent a missing quarter. */
export function earlierQuarterReport(report: CeoReport, history: CeoReport[]): CeoReport | null {
  if (!/^\d{4}-Q[1-4]$/.test(report.quarter)) return null;
  return [...history].filter(r => /^\d{4}-Q[1-4]$/.test(r.quarter) && r.quarter < report.quarter)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0] ?? null;
}

export function ceoReportText(report: CeoReport): string {
  return ["Your CEO Strategic Baseline Report", `Completed: ${report.completedAt}`, `Quarter: ${report.quarter}`, `Assessment version: ${report.assessmentVersion}`, `Overall baseline: ${report.overallScore}/100`, "", ...report.domains.map(d => `${d.name}: ${d.score}/8`), "", "Three suggested priorities", ...report.priorities.map((d, i) => `${i + 1}. ${d.name}`), "", "Recommended first action", report.firstAction, "", "This is a self-reported coaching baseline. Review it with your advisor and business metrics; it does not establish financial viability or hiring readiness."].join("\n");
}
