import type { ReactNode } from "react";
import { Filter, X } from "lucide-react";
import {
  Button,
  Chip,
  chipRowStyles,
  chipStyles,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import {
  activeFilterCount,
  hasActiveFilters,
  toggleValue,
  type AutomationFilters,
  type SourceFilter,
  type StatusFilter,
} from "./automationFilters";

/**
 * The Automations list's Filters button, panel and applied-filter chips — the
 * same pieces Kajabi's Automations page has (QA sheet row 71). The state itself
 * lives in the URL and is owned by the page; these only draw it and report
 * changes, which apply at once.
 */

export interface FilterLabels {
  when: (type: string) => string;
  then: (type: string) => string;
  related: (ref: string) => string;
}

const STATUS_CHOICES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Running" },
  { value: "paused", label: "Paused" },
];

const SOURCE_CHOICES: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "kajabi", label: "Imported from Kajabi" },
  { value: "local", label: "Created here" },
];

export function AutomationFiltersButton({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      className="h-11"
      aria-expanded={open}
      aria-controls="automation-filters-panel"
      onClick={onClick}
    >
      <Filter />
      Filters
      {count > 0 && (
        <span className="grid min-w-5 place-items-center rounded-full bg-plum px-1.5 text-[0.7rem] font-bold tabular-nums text-white">
          {count}
        </span>
      )}
    </Button>
  );
}

function FilterGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {title}
        {hint && <span className="ml-2 font-normal normal-case tracking-normal">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

export function AutomationFiltersPanel({
  filters,
  whenValues,
  thenValues,
  relatedValues,
  labels,
  onChange,
  onClear,
  onClose,
}: {
  filters: AutomationFilters;
  whenValues: string[];
  thenValues: string[];
  relatedValues: string[];
  labels: FilterLabels;
  onChange: (next: Partial<AutomationFilters>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const relatedLeft = relatedValues.filter((ref) => !filters.related.includes(ref));

  return (
    <div
      id="automation-filters-panel"
      className="w-full rounded-xl border border-hairline bg-white/[0.02] p-4"
    >
      <p className="mb-4 text-sm font-semibold text-ink">Filtering by:</p>
      <div className="grid gap-5">
        <FilterGroup title="When" hint="what starts it">
          {whenValues.length === 0 ? (
            <p className="text-sm text-ink-soft">No triggers to choose from yet.</p>
          ) : (
            <div className={chipRowStyles}>
              {whenValues.map((type) => (
                <Chip
                  key={type}
                  selected={filters.when.includes(type)}
                  onClick={() => onChange({ when: toggleValue(filters.when, type) })}
                >
                  {labels.when(type)}
                </Chip>
              ))}
            </div>
          )}
        </FilterGroup>

        <FilterGroup title="Then" hint="what it does">
          {thenValues.length === 0 ? (
            <p className="text-sm text-ink-soft">No steps to choose from yet.</p>
          ) : (
            <div className={chipRowStyles}>
              {thenValues.map((type) => (
                <Chip
                  key={type}
                  selected={filters.then.includes(type)}
                  onClick={() => onChange({ then: toggleValue(filters.then, type) })}
                >
                  {labels.then(type)}
                </Chip>
              ))}
            </div>
          )}
        </FilterGroup>

        <div className="grid gap-5 sm:grid-cols-2">
          <FilterGroup title="Status">
            <div className={chipRowStyles}>
              {STATUS_CHOICES.map((choice) => (
                <Chip
                  key={choice.value}
                  selected={filters.status === choice.value}
                  onClick={() => onChange({ status: choice.value })}
                >
                  {choice.label}
                </Chip>
              ))}
            </div>
          </FilterGroup>

          <FilterGroup title="Source">
            <div className={chipRowStyles}>
              {SOURCE_CHOICES.map((choice) => (
                <Chip
                  key={choice.value}
                  selected={filters.source === choice.value}
                  onClick={() => onChange({ source: choice.value })}
                >
                  {choice.label}
                </Chip>
              ))}
            </div>
          </FilterGroup>
        </div>

        {(relatedValues.length > 0 || filters.related.length > 0) && (
          <FilterGroup title="Related to" hint="the form, offer, tag… it is about">
            <div className="grid gap-2">
              {filters.related.length > 0 && (
                <div className={chipRowStyles}>
                  {filters.related.map((ref) => (
                    <Chip
                      key={ref}
                      selected
                      aria-label={`Stop filtering by ${labels.related(ref)}`}
                      onClick={() => onChange({ related: toggleValue(filters.related, ref) })}
                    >
                      {labels.related(ref)}
                      <X className="size-3.5" aria-hidden />
                    </Chip>
                  ))}
                </div>
              )}
              {relatedLeft.length > 0 && (
                <select
                  className={selectStyles}
                  aria-label="Add a related item to filter by"
                  value=""
                  onChange={(event) => {
                    const ref = event.target.value;
                    if (ref) onChange({ related: [...filters.related, ref] });
                  }}
                >
                  <option value="">Choose one…</option>
                  {relatedLeft.map((ref) => (
                    <option key={ref} value={ref}>
                      {labels.related(ref)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </FilterGroup>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-hairline/60 pt-4">
        {hasActiveFilters(filters) && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** One removable chip per applied filter, as Kajabi shows them under its toolbar. */
export function AutomationFilterChips({
  filters,
  labels,
  onChange,
  onClear,
}: {
  filters: AutomationFilters;
  labels: FilterLabels;
  onChange: (next: Partial<AutomationFilters>) => void;
  onClear: () => void;
}) {
  if (activeFilterCount(filters) === 0) return null;

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filters.when.map((type) => ({
      key: `when:${type}`,
      label: `When: ${labels.when(type)}`,
      remove: () => onChange({ when: toggleValue(filters.when, type) }),
    })),
    ...filters.then.map((type) => ({
      key: `then:${type}`,
      label: `Then: ${labels.then(type)}`,
      remove: () => onChange({ then: toggleValue(filters.then, type) }),
    })),
    ...(filters.status === "all"
      ? []
      : [
          {
            key: "status",
            label: `Status: ${filters.status === "active" ? "Running" : "Paused"}`,
            remove: () => onChange({ status: "all" }),
          },
        ]),
    ...(filters.source === "all"
      ? []
      : [
          {
            key: "source",
            label: filters.source === "kajabi" ? "Imported from Kajabi" : "Created here",
            remove: () => onChange({ source: "all" }),
          },
        ]),
    ...filters.related.map((ref) => ({
      key: `related:${ref}`,
      label: `Related to: ${labels.related(ref)}`,
      remove: () => onChange({ related: toggleValue(filters.related, ref) }),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filters applied">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className={chipStyles(false)}
          aria-label={`Remove filter ${chip.label}`}
          onClick={chip.remove}
        >
          {chip.label}
          <X className="size-3.5" aria-hidden />
        </button>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
