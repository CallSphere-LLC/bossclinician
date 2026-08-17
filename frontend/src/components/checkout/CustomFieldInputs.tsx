import { useId } from "react";
import { Check } from "lucide-react";
import { LuxeInput, LuxeSelect, LuxeTextarea } from "@/components/luxe/LuxeField";
import { cn } from "@/lib/cn";
import type { CustomFieldDef } from "@/lib/commerceApi";

interface CustomFieldInputsProps {
  fields: CustomFieldDef[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

/** What a checked box stores, and therefore what "required" has to see. */
export const CHECKBOX_YES = "Yes";

/**
 * The offer's own order-form questions.
 *
 * Rendered from what Yvette configured, so a question added in the admin appears
 * here without a deploy. An unknown `type` falls back to a text box rather than
 * disappearing — a question the buyer cannot answer is a question the server will
 * reject them for leaving blank.
 */
export function CustomFieldInputs({
  fields,
  values,
  errors,
  onChange,
  disabled = false,
}: CustomFieldInputsProps) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-5">
      {fields.map((field) => {
        const label = field.label || field.key;
        const value = values[field.key] ?? "";
        const error = errors[field.key];

        if (field.options.length > 0) {
          return (
            <LuxeSelect
              key={field.key}
              label={label}
              required={field.required}
              error={error}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            >
              <option value="">Choose one…</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </LuxeSelect>
          );
        }

        if (field.type === "textarea") {
          return (
            <LuxeTextarea
              key={field.key}
              label={label}
              required={field.required}
              error={error}
              value={value}
              rows={4}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          );
        }

        if (field.type === "checkbox") {
          return (
            <CheckboxField
              key={field.key}
              label={label}
              required={field.required}
              error={error}
              checked={value === CHECKBOX_YES}
              disabled={disabled}
              onChange={(checked) => onChange(field.key, checked ? CHECKBOX_YES : "")}
            />
          );
        }

        return (
          <LuxeInput
            key={field.key}
            label={label}
            required={field.required}
            error={error}
            value={value}
            type={INPUT_TYPES.includes(field.type) ? field.type : "text"}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );
      })}
    </div>
  );
}

/** The `type` values a browser renders a useful keyboard or picker for. */
const INPUT_TYPES = ["text", "email", "tel", "url", "number", "date"];

function CheckboxField({
  label,
  required,
  error,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  required: boolean;
  error?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const errorId = useId();

  return (
    <div>
      <label
        className={cn(
          "flex min-h-[2.75rem] cursor-pointer items-start gap-3 py-1",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {/* Validation is ours, not the browser's: a `required` control this
            small and visually hidden produces a native bubble pointing at
            nothing. */}
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border transition-colors duration-300 ease-luxe",
            checked ? "border-gold bg-gold-foil text-night-deep" : "border-white/25",
            error && !checked && "border-red-400/60",
          )}
        >
          {checked && <Check className="h-4 w-4" />}
        </span>
        <span className="text-sm leading-relaxed text-orchid">
          {label}
          {required && (
            <span aria-hidden className="ml-1 text-gold">
              *
            </span>
          )}
        </span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
