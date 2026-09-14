import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@/pages/admin/ui/primitives";
import {
  MAX_REASONS,
  newReasonRow,
  reasonProblems,
  rowsFromText,
  textFromRows,
  type ReasonRow,
} from "@/lib/cancelReasons";

/**
 * The cancellation-reasons editor on Settings → Payments.
 *
 * It replaces a text box that asked the owner to type `too_expensive | It's too
 * expensive` on each line — a report key, a pipe and the wording — where one
 * stray character silently dropped a reason from the customer's form. Here she
 * edits the wording, the order and the list; the keys the reports group by are
 * kept for her.
 *
 * The value in and out is still the stored text, so the settings card saves it
 * like any other field.
 */
export function CancelReasonsEditor({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState<ReasonRow[]>(() => rowsFromText(value));
  /** The last text this editor produced, so its own echo is not re-parsed. */
  const emitted = useRef(value);

  useEffect(() => {
    // A new value from outside (a save reloaded the card) — every reason in it
    // is saved now, so its key is locked from here on.
    if (value !== emitted.current) {
      emitted.current = value;
      setRows(rowsFromText(value));
    }
  }, [value]);

  const update = (next: ReasonRow[]) => {
    setRows(next);
    const text = textFromRows(next);
    emitted.current = text;
    onChange(text);
  };

  const problems = useMemo(() => reasonProblems(rows), [rows]);

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };

  return (
    <fieldset aria-describedby={`${id}-help`} className="space-y-3">
      <legend className="mb-1.5 text-[0.8rem] font-semibold text-ink">{label}</legend>
      <p id={`${id}-help`} className="text-xs text-ink-soft">
        {help ??
          "Customers choose one of these, in this order, when they cancel. They feed the “People who left” and “What people said when they left” reports."}{" "}
        Rewording a reason keeps its history in your reports.
      </p>

      <ol className="space-y-2.5">
        {rows.map((row, index) => {
          const error = problems.rows[row.id];
          const inputId = `${id}-${row.id}`;
          return (
            <li key={row.id} className="rounded-xl border border-hairline px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={inputId} className="w-6 shrink-0 text-sm text-ink-soft">
                  {index + 1}.
                  <span className="sr-only"> Cancellation reason {index + 1}</span>
                </label>
                <Input
                  id={inputId}
                  value={row.label}
                  maxLength={200}
                  placeholder="e.g. It's too expensive"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  className="min-w-[12rem] flex-1"
                  onChange={(e) =>
                    update(rows.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)))
                  }
                />
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11"
                    aria-label={`Move reason ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11"
                    aria-label={`Move reason ${index + 1} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11"
                    aria-label={`Remove reason ${index + 1}`}
                    onClick={() => update(rows.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p className="mt-1 pl-8 text-[0.7rem] text-ink-soft/80">
                {row.keyLocked
                  ? `In reports as “${row.key}”${row.key === "other" ? " · asks the customer to say more" : ""}`
                  : "New — saved with the next Save"}
              </p>
              {error && (
                <p id={`${inputId}-error`} role="alert" className="mt-1 pl-8 text-xs font-medium text-red-400">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {problems.list && (
        <p role="alert" className="text-xs font-medium text-red-400">
          {problems.list}
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={rows.length >= MAX_REASONS}
        onClick={() => update([...rows, newReasonRow()])}
      >
        <Plus />
        Add a reason
      </Button>
      <p className="text-xs text-ink-soft">
        Removing a reason takes it off the form; answers already given stay in your reports.
      </p>
    </fieldset>
  );
}
