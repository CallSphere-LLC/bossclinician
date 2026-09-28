import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Filter, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  ContactFilterOptions,
  ContactFilterRow,
  FilterCategory,
  FilterConditional,
} from "@/lib/contactsApi";
import { Button, Input, selectStyles } from "@/pages/admin/ui/primitives";

/**
 * Kajabi's contacts toolbar, piece for piece (QA sheet row 23, and the owner's
 * own request): a Segments menu with a "Find…" box inside it, the search box,
 * and a Filters button that opens "Filtering by:" rows of
 * [Category][Conditional][Value][🗑], "+ Add filter" and "Apply Filters".
 *
 * Everything on offer comes from GET /admin/contacts/filter-options, which is
 * built from the same table the server compiles filters with
 * (services/contactFilters.ts) — so the menu can't offer a filter the server
 * would refuse, and a new category there appears here without a change.
 *
 * The rows are edited as a draft and only applied on "Apply Filters", as in
 * Kajabi; the applied rows live in the address bar, so a refresh keeps them.
 */

/* ------------------------------------------------------------ url helpers */

/** The `filters` query parameter → rows, dropping anything that isn't one. */
export function decodeFilterRows(raw: string | null): ContactFilterRow[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      .map((row) => ({
        category: typeof row.category === "string" ? row.category : "",
        op: typeof row.op === "string" ? row.op : "",
        value: typeof row.value === "string" ? row.value : "",
        text: typeof row.text === "string" ? row.text : "",
      }))
      .filter((row) => row.category && row.op)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function encodeFilterRows(rows: ContactFilterRow[]): string | null {
  return rows.length === 0 ? null : JSON.stringify(rows);
}

const EMPTY_ROW: ContactFilterRow = { category: "", op: "", value: "", text: "" };

function conditionalOf(options: ContactFilterOptions | null, row: ContactFilterRow): FilterConditional | undefined {
  return options?.categories.find((category) => category.key === row.category)?.conditionals.find((c) => c.key === row.op);
}

/** Whether a row says enough to be sent. An incomplete row is never applied half-read. */
export function rowComplete(options: ContactFilterOptions | null, row: ContactFilterRow): boolean {
  const conditional = conditionalOf(options, row);
  if (!conditional || conditional.unavailable) return false;
  switch (conditional.value) {
    case "none":
      return true;
    case "field_text":
      return row.value !== "" && row.text.trim() !== "";
    case "date_range":
      return row.value !== "" && (row.value !== "custom" || /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(row.text));
    case "money":
      return /^\$?\s*[\d,]+(\.\d{1,2})?$/.test(row.value.trim());
    default:
      return row.value !== "";
  }
}

/** "Tags has tag VIP" — how an applied row reads on the Filters button's tooltip and the summary line. */
export function describeRow(options: ContactFilterOptions | null, row: ContactFilterRow): string {
  const category = options?.categories.find((candidate) => candidate.key === row.category);
  const conditional = category?.conditionals.find((candidate) => candidate.key === row.op);
  if (!category || !conditional) return "";
  let value = "";
  if (conditional.value === "days" || conditional.value === "engagement_days") value = `${row.value} days`;
  else if (conditional.value === "money") value = `$${row.value.replace(/^\$/, "")}`;
  else if (conditional.value === "date_range") {
    value =
      row.value === "custom"
        ? row.text.replace("~", " to ")
        : (options?.datePresets.find((preset) => preset.key === row.value)?.label ?? row.value);
  } else if (conditional.options) {
    value = options?.options[conditional.options]?.find((choice) => choice.value === row.value)?.label ?? row.value;
  }
  if (conditional.value === "field_text") value = `${value} ${row.text}`.trim();
  return [category.label, conditional.label, value].filter(Boolean).join(" ");
}

/* ---------------------------------------------------------- Segments menu */

export function SegmentMenu({
  options,
  value,
  onChange,
}: {
  options: ContactFilterOptions | null;
  value: string;
  onChange: (segment: string) => void;
}) {
  const [find, setFind] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  const segments = options?.segments ?? [{ key: "all", label: "All Contacts", kind: "built_in" as const }];
  const current = segments.find((segment) => segment.key === value)?.label ?? "All Contacts";
  const shown = segments.filter((segment) => segment.label.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        setFind("");
        // Radix focuses the menu itself on open; the Find box is where she types.
        if (open) setTimeout(() => findRef.current?.focus(), 0);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" className="h-11 min-w-[11rem] justify-between" aria-label={`Segment: ${current}`}>
          <span className="truncate">{current}</span>
          <ChevronDown className="text-ink-soft" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="theme-console z-50 w-72 rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
        >
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft/60" aria-hidden />
            <Input
              ref={findRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              // Letters go to the box, not to the menu's type-to-jump; arrows
              // and Enter still move through the list below it.
              onKeyDown={(e) => {
                if (e.key.length === 1 || e.key === "Backspace") e.stopPropagation();
              }}
              placeholder="Find…"
              aria-label="Find a segment"
              className="h-10 pl-9"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-ink-soft">No segment is called that.</p>}
            {shown.map((segment, index) => {
              const firstSaved = segment.kind === "saved" && shown[index - 1]?.kind !== "saved";
              const firstTeam = segment.kind === "team" && index > 0;
              return (
                <div key={segment.key}>
                  {(firstSaved || firstTeam) && <DropdownMenu.Separator className="my-1.5 h-px bg-hairline" />}
                  <DropdownMenu.Item
                    onSelect={() => onChange(segment.key)}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-white/[0.07]"
                  >
                    <Check className={cn("size-4 shrink-0", segment.key === value ? "text-plum" : "invisible")} aria-hidden />
                    <span className={cn("truncate", segment.kind === "team" && "text-ink-soft")}>{segment.label}</span>
                  </DropdownMenu.Item>
                </div>
              );
            })}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ---------------------------------------------------------- Filters panel */

export function FiltersButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" className="h-11" aria-expanded={open} onClick={onClick}>
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

export function FiltersPanel({
  options,
  applied,
  onApply,
}: {
  options: ContactFilterOptions | null;
  applied: ContactFilterRow[];
  onApply: (rows: ContactFilterRow[]) => void;
}) {
  // A draft, so rows can be half-built without the list jumping on every change.
  const [rows, setRows] = useState<ContactFilterRow[]>(applied.length ? applied : [EMPTY_ROW]);
  const appliedKey = JSON.stringify(applied);
  useEffect(() => {
    setRows(applied.length ? applied : [EMPTY_ROW]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when what's applied actually changes
  }, [appliedKey]);

  const meaningful = rows.filter((row) => row.category !== "");
  const complete = meaningful.every((row) => rowComplete(options, row));
  const changed = JSON.stringify(meaningful) !== appliedKey;

  function update(index: number, next: Partial<ContactFilterRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  return (
    <div className="w-full rounded-xl border border-hairline bg-white/[0.02] p-4">
      <p className="mb-3 text-sm font-semibold text-ink">Filtering by:</p>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <FilterRowEditor
            key={index}
            options={options}
            row={row}
            onChange={(next) => update(index, next)}
            onRemove={() => setRows((current) => (current.length === 1 ? [EMPTY_ROW] : current.filter((_, i) => i !== index)))}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRows((current) => [...current, EMPTY_ROW])} disabled={rows.length >= 20}>
          <Plus />
          Add filter
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!complete && <p className="text-xs text-ink-soft">Finish each row, or remove it, to apply.</p>}
          {applied.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onApply([])}>
              Clear filters
            </Button>
          )}
          <Button size="sm" disabled={!complete || !changed} onClick={() => onApply(meaningful)}>
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterRowEditor({
  options,
  row,
  onChange,
  onRemove,
}: {
  options: ContactFilterOptions | null;
  row: ContactFilterRow;
  onChange: (next: Partial<ContactFilterRow>) => void;
  onRemove: () => void;
}) {
  const category: FilterCategory | undefined = options?.categories.find((candidate) => candidate.key === row.category);
  const conditional = category?.conditionals.find((candidate) => candidate.key === row.op);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={row.category}
          // A new category starts its row over: its conditionals and values are different ones.
          onChange={(e) => onChange({ category: e.target.value, op: "", value: "", text: "" })}
          aria-label="Category"
          className={cn(selectStyles, "w-full sm:w-48")}
        >
          <option value="">Category…</option>
          {options?.categories.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </select>
        <select
          value={row.op}
          onChange={(e) => {
            const next = category?.conditionals.find((candidate) => candidate.key === e.target.value);
            // Keep the value when the new conditional reads the same kind of value.
            const keep = next && conditional && next.value === conditional.value && next.options === conditional.options;
            onChange({ op: e.target.value, ...(keep ? {} : { value: "", text: "" }) });
          }}
          disabled={!category}
          aria-label="Conditional"
          className={cn(selectStyles, "w-full sm:w-56")}
        >
          <option value="">Conditional…</option>
          {category?.conditionals.map((candidate) => (
            <option key={candidate.key} value={candidate.key} disabled={Boolean(candidate.unavailable)}>
              {candidate.unavailable ? `${candidate.label} (not on this site)` : candidate.label}
            </option>
          ))}
        </select>
        <ValueEditor options={options} conditional={conditional} row={row} onChange={onChange} />
        <Button variant="ghost" size="iconSm" aria-label="Remove this filter" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      {category?.note && <p className="text-xs text-ink-soft">{category.note}</p>}
    </div>
  );
}

function ValueEditor({
  options,
  conditional,
  row,
  onChange,
}: {
  options: ContactFilterOptions | null;
  conditional: FilterConditional | undefined;
  row: ContactFilterRow;
  onChange: (next: Partial<ContactFilterRow>) => void;
}) {
  const choices = useMemo(
    () => (conditional?.options ? (options?.options[conditional.options] ?? []) : []),
    [options, conditional],
  );
  const placeholder = (
    <select disabled aria-label="Value" className={cn(selectStyles, "w-full sm:w-64")}>
      <option>Value…</option>
    </select>
  );
  if (!conditional) return placeholder;

  const choiceSelect = (label: string): ReactNode => (
    <select
      value={row.value}
      onChange={(e) => onChange({ value: e.target.value })}
      aria-label={label}
      disabled={choices.length === 0}
      className={cn(selectStyles, "w-full sm:w-64")}
    >
      <option value="">{choices.length === 0 ? "Nothing to choose yet" : "Value…"}</option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.hint ? `${choice.label} — ${choice.hint}` : choice.label}
        </option>
      ))}
    </select>
  );

  switch (conditional.value) {
    case "none":
      return null;
    case "choice":
    case "field":
      return choiceSelect(conditional.value === "field" ? "Field" : "Value");
    case "field_text":
      return (
        <>
          {choiceSelect("Field")}
          <Input
            value={row.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Value…"
            aria-label="Text to compare"
            className="h-11 w-full sm:w-48"
          />
        </>
      );
    case "days":
    case "engagement_days": {
      const days = conditional.value === "days" ? (options?.days ?? []) : (options?.engagementDays ?? []);
      return (
        <select
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="How many days"
          className={cn(selectStyles, "w-full sm:w-40")}
        >
          <option value="">Value…</option>
          {days.map((day) => (
            <option key={day} value={String(day)}>
              {day} days
            </option>
          ))}
        </select>
      );
    }
    case "money":
      return (
        <div className="relative w-full sm:w-40">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-soft">$</span>
          <Input
            inputMode="decimal"
            value={row.value.replace(/^\$/, "")}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="0.00"
            aria-label="Amount in dollars"
            className="h-11 pl-7 font-bold tabular-nums"
          />
        </div>
      );
    case "date_range": {
      const [from = "", to = ""] = row.text.split("~");
      return (
        <>
          <select
            value={row.value}
            onChange={(e) => onChange({ value: e.target.value, text: e.target.value === "custom" ? row.text : "" })}
            aria-label="When"
            className={cn(selectStyles, "w-full sm:w-56")}
          >
            <option value="">Value…</option>
            {options?.datePresets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
          {row.value === "custom" && (
            <>
              <Input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange({ text: `${e.target.value}~${to}` })}
                aria-label="From"
                className="h-11 w-full sm:w-44"
              />
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange({ text: `${from}~${e.target.value}` })}
                aria-label="To"
                className="h-11 w-full sm:w-44"
              />
            </>
          )}
        </>
      );
    }
    default:
      return placeholder;
  }
}
