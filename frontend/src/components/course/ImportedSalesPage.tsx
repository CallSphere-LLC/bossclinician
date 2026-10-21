import type { MouseEvent } from "react";
import { useNavigate } from "react-router";
import { priceLabel, type CourseDetailResponse } from "./CoursePriceLabel";
import doctorHtml from "@/content/doctor/source.html?raw";
import protectionHtml from "@/content/protection/source.html?raw";
import profileHtml from "@/content/profile/source.html?raw";
import "@/content/doctor/source.css";
import "@/content/protection/source.css";
import "@/content/profile/source.css";

const pages: Record<string, { html: string; className: string }> = {
  "provider-partnership-guide": { html: doctorHtml, className: "doctor-sales-page" },
  "private-practice-protection-pack": { html: protectionHtml, className: "protection-sales-page" },
  "from-profile-to-profit": { html: profileHtml, className: "profile-sales-page" },
};
export const hasImportedSalesPage = (slug: string) => Object.hasOwn(pages, slug);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]!);

/** Sanitized, locally bundled owner source content; purchases use the live catalogue. */
export default function ImportedSalesPage({ course }: { course: CourseDetailResponse }) {
  const navigate = useNavigate();
  const page = pages[course.slug];
  if (!page) return null;
  const offer = course.offers.find(o => o.slug === course.slug);
  const destination = course.owned ? `/library/${encodeURIComponent(course.slug)}`
    : offer?.available ? `/checkout/${encodeURIComponent(offer.slug)}` : "";
  let html = page.html.replaceAll("__SOURCE_PRICE__", escapeHtml(offer ? priceLabel(offer) : course.priceText))
    .replaceAll("__SOURCE_CHECKOUT__", destination || "#");
  if (course.owned || !destination) {
    const label = course.owned ? "Open your training" : offer?.unavailableReason || "Enrollment is currently unavailable";
    html = html.replace(/<a([^>]*data-source-buy="true"[^>]*)>[\s\S]*?<\/a>/g,
      (_, attributes: string) => `<a${attributes}${destination ? "" : ' aria-disabled="true" tabindex="-1"'}>${escapeHtml(label)}</a>`);
  }
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a[data-source-buy]");
    if (!anchor) return;
    event.preventDefault();
    if (destination) navigate(destination);
  }
  return <div className={page.className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
