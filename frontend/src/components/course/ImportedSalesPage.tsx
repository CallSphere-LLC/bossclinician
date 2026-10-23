import type { MouseEvent } from "react";
import { useNavigate } from "react-router";
import { priceLabel, type CourseDetailResponse } from "./CoursePriceLabel";
import doctorHtml from "@/content/doctor/source.html?raw";
import protectionHtml from "@/content/protection/source.html?raw";
import profileHtml from "@/content/profile/source.html?raw";
import starterHtml from "@/content/starter/source.html?raw";
import "@/content/doctor/source.css";
import "@/content/protection/source.css";
import "@/content/profile/source.css";
import "@/content/starter/source.css";

/**
 * `sourceAmountCents` is the price the captured page was written for. Lines
 * marked `data-source-compare` ("usually $197 / you're saving $170") are only
 * true at that price, so they are dropped when the live offer differs.
 */
const pages: Record<string, { html: string; className: string; sourceAmountCents?: number }> = {
  "provider-partnership-guide": { html: doctorHtml, className: "doctor-sales-page" },
  "private-practice-protection-pack": { html: protectionHtml, className: "protection-sales-page" },
  "from-profile-to-profit": { html: profileHtml, className: "profile-sales-page" },
  "private-practice-starter-suite": { html: starterHtml, className: "starter-sales-page", sourceAmountCents: 2700 },
};
export const hasImportedSalesPage = (slug: string) => Object.hasOwn(pages, slug);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]!);
// Wistia media ids are ten lowercase alphanumerics; anything else is ignored.
const wistiaId = /^[a-z0-9]{10}$/;

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
  if (page.sourceAmountCents !== undefined && offer?.amountCents !== page.sourceAmountCents) {
    html = html.replace(/<(h[1-6]|p|div)\b[^>]*\bdata-source-compare="true"[^>]*>[\s\S]*?<\/\1>/g, "");
  }
  if (course.owned || !destination) {
    const label = course.owned ? "Open your training" : offer?.unavailableReason || "Enrollment is currently unavailable";
    html = html.replace(/<a([^>]*data-source-buy="true"[^>]*)>[\s\S]*?<\/a>/g,
      (_, attributes: string) => `<a${attributes}${destination ? "" : ' aria-disabled="true" tabindex="-1"'}>${escapeHtml(label)}</a>`);
  }
  // Image and banner links keep their artwork; with nowhere to go they are inert.
  if (!destination) {
    html = html.replace(/<a([^>]*data-source-checkout="true"[^>]*)>/g,
      (_, attributes: string) => `<a${attributes} aria-disabled="true" tabindex="-1">`);
  }
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // Click-to-play: the poster is replaced by the player only on request, so
    // nothing is loaded from the video host until a visitor asks for it.
    const video = target.closest<HTMLAnchorElement>("a[data-source-video]");
    if (video) {
      const id = video.dataset.sourceVideo ?? "";
      if (!wistiaId.test(id)) return;
      event.preventDefault();
      const frame = document.createElement("iframe");
      frame.src = `https://fast.wistia.net/embed/iframe/${id}?autoPlay=true`;
      frame.title = (video.getAttribute("aria-label") ?? "Video").replace(/^Play video: /, "");
      frame.allow = "autoplay; fullscreen; picture-in-picture";
      frame.allowFullscreen = true;
      video.replaceWith(frame);
      frame.focus();
      return;
    }
    const anchor = target.closest("a[data-source-buy], a[data-source-checkout]");
    if (!anchor) return;
    event.preventDefault();
    if (destination) navigate(destination);
  }
  return <div className={page.className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
