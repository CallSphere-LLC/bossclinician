import { cn } from "@/lib/cn";
import { COURSE_TABS, type CourseTab } from "./courseHub";

/**
 * Outline · Offers · Customers · Settings, across the top of every course —
 * the row Kajabi puts there. Styled as the contact page's tabs are, so the
 * console has one tab bar rather than two.
 */
export function CourseTabs({ tab, onSelect }: { tab: CourseTab; onSelect: (tab: CourseTab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="This course"
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {COURSE_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`course-tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls={`course-panel-${item.id}`}
          onClick={() => onSelect(item.id)}
          className={cn(
            "-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
            tab === item.id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
