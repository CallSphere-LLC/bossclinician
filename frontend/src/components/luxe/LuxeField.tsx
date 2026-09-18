import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls for the dark theme.
 *
 * `min-h-[2.75rem]` on every control is deliberate rather than incidental: a
 * form is the densest run of tap targets on any page, and the phone audit
 * showed sub-44px controls are where mis-taps actually happen.
 *
 * The focus ring is gold and offset rather than a border-colour change, so it
 * stays visible against both the filled and empty states.
 */
const CONTROL = cn(
  "min-h-[2.75rem] w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3",
  "text-[0.95rem] text-white placeholder:text-white/30",
  "outline-none transition-colors duration-300",
  "hover:border-white/20",
  "focus-visible:border-gold/60 focus-visible:bg-white/[0.07]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

interface FieldShellProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function LuxeFieldShell({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid"
      >
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-gold">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-orchid-faint">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
};

export function LuxeInput({
  label,
  hint,
  error,
  className,
  wrapperClassName,
  required,
  ...props
}: InputProps) {
  const id = useId();
  return (
    <LuxeFieldShell
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={wrapperClassName}
    >
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, error && "border-red-400/60", className)}
        {...props}
      />
    </LuxeFieldShell>
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
};

export function LuxeTextarea({
  label,
  hint,
  error,
  className,
  wrapperClassName,
  required,
  rows = 5,
  ...props
}: TextareaProps) {
  const id = useId();
  return (
    <LuxeFieldShell
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={wrapperClassName}
    >
      <textarea
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, "resize-y leading-relaxed", error && "border-red-400/60", className)}
        {...props}
      />
    </LuxeFieldShell>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
};

export function LuxeSelect({
  label,
  hint,
  error,
  className,
  wrapperClassName,
  required,
  children,
  ...props
}: SelectProps) {
  const id = useId();
  return (
    <LuxeFieldShell
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      className={wrapperClassName}
    >
      {/* `[&>option]` styles the native popup, which otherwise inherits the OS
          light palette and flashes white against the dark form. */}
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(
          CONTROL,
          "appearance-none bg-[length:0.7rem] bg-[right_1rem_center] bg-no-repeat pr-10",
          "[background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23C9A46A' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")]",
          // Tokens, not `text-white`: both follow the theme, so the list is dark
          // on white in the light theme instead of white on white.
          "[&>option]:bg-night-raised [&>option]:text-ink [&>optgroup]:bg-night-raised [&>optgroup]:text-ink",
          error && "border-red-400/60",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </LuxeFieldShell>
  );
}

export { CONTROL as luxeControlClass };
