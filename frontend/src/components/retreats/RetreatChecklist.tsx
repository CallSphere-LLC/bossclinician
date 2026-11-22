import type { ChecklistItem } from "@/lib/retreatsApi";
import { StatusPill } from "./retreatUi";

/**
 * "My Preparation" — every status comes from the server's records (signatures,
 * submissions, organizer reviews). This list only displays them; ticking
 * anything here is not possible by design.
 */
export function RetreatChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ol className="flex flex-col divide-y divide-white/[0.07] rounded-2xl border border-white/10">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <a
              href={`#${item.section}`}
              className="font-semibold text-white hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              {item.label}
            </a>
            {item.detail && <p className="mt-0.5 text-xs text-orchid-dim">{item.detail}</p>}
            {item.status === "needs_attention" && item.reviewNote && (
              <p className="mt-1 text-xs font-medium text-amber-200">From our team: {item.reviewNote}</p>
            )}
          </div>
          <StatusPill status={item.status} />
        </li>
      ))}
    </ol>
  );
}
