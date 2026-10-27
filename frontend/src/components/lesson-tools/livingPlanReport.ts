import { PLAN_GROUPS, planYear, type AnnualPlan } from "./livingPlan";
import { escapeHtml } from "./DashboardKit";

/** Snapshot every field, including blanks, without changing any stored data. */
export function livingPlanReport(plan: AnnualPlan, archived = false) {
  return {
    year: planYear(plan), archived,
    sections: PLAN_GROUPS.map((group) => ({
      title: group.title, description: group.desc, reviewed: !!plan.reviewed[group.id],
      fields: group.fields.map((field) => {
        const raw = plan.values[field.key] ?? "";
        return { label: field.label, value: raw.trim() === "" ? "Not entered"
          : field.type === "number" && field.label.includes("($)") && Number.isFinite(Number(raw))
            ? Number(raw).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 20 }) : raw };
      }),
    })),
  };
}

export function livingPlanHtml(plan: AnnualPlan, archived = false): string {
  const report = livingPlanReport(plan, archived);
  return `<style>section{break-inside:auto}h2{break-after:avoid}table{table-layout:fixed}td,th{overflow-wrap:anywhere}tr{break-inside:auto}</style><h1>My ${report.year} Annual Business Plan${archived ? " (archived)" : ""}</h1><p class="muted">Boss Clinician · ${report.sections.filter((section) => section.reviewed).length} of 11 sections reviewed</p>${report.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p class="muted">${section.reviewed ? "Reviewed" : "Not yet reviewed"} · ${escapeHtml(section.description)}</p><table><tbody>${section.fields.map((field) => `<tr><th style="width:38%">${escapeHtml(field.label)}</th><td style="white-space:pre-wrap">${escapeHtml(field.value)}</td></tr>`).join("")}</tbody></table></section>`).join("")}<p class="note">A typed name is an acknowledgment only, not a verified digital signature. Financial values are user supplied and not independently verified; this is not a lender-ready certified statement.</p>`;
}
