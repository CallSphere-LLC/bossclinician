import type { MouseEvent } from "react";
import { useNavigate } from "react-router";
import type { CourseDetailResponse } from "./CoursePriceLabel";
import { priceLabel } from "./CoursePriceLabel";
import sourceHtml from "@/content/ramp-up/source.html?raw";
import "@/content/ramp-up/source.css";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Owner-requested reproduction of /rampedrevenue, captured 21 October 2026.
 * The bundled template is static, stripped of scripts/forms/event handlers;
 * CSS is scoped to this page and every image/font is hosted locally.
 * Keep purchasing tied to the live catalogue, never to the old Kajabi checkout.
 */
export default function RampUpSalesPage({ course }: { course: CourseDetailResponse }) {
  const navigate = useNavigate();
  const offer = course.offers.find(o => o.slug === "ramp-up-rate-formula");
  const price = offer ? priceLabel(offer) : course.priceText;
  const destination = course.owned ? "/library/ramp-up-rate-formula" : offer?.available ? `/checkout/${encodeURIComponent(offer.slug)}` : "";
  let html = sourceHtml
    .replaceAll("__RAMP_PRICE__", escapeHtml(price))
    .replaceAll("__RAMP_CHECKOUT__", destination || "#");
  if (offer?.amountCents !== 9700) html = html.replaceAll("Original Price: $197", "");
  if (course.owned || !destination) {
    const label = course.owned ? "Open your training" : offer?.unavailableReason || "Enrollment is currently unavailable";
    html = html.replace(/<a([^>]*data-ramp-buy="true"[^>]*)>[\s\S]*?<\/a>/g,
      (_, attributes: string) => `<a${attributes}${destination ? "" : ' aria-disabled="true" tabindex="-1"'}>${escapeHtml(label)}</a>`);
  }
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a[data-ramp-buy]");
    if (!anchor) return;
    event.preventDefault();
    if (destination) navigate(destination);
  }
  return <div className="ramp-up-page" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
