import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Shared chrome for the in-lesson calculators: a card, labelled number inputs
 * and result figures. Figures use the body font in bold with tabular numerals
 * (never the display serif) so columns of money line up and read as data.
 */

export function ToolCard({ title, intro, children, footnote }: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-gold/25 bg-white/[0.03] p-5 shadow-glass sm:p-7"
    >
      <h2 className="font-display text-xl text-white sm:text-2xl">{title}</h2>
      {intro && <div className="mt-2 text-sm text-orchid">{intro}</div>}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
      {footnote && <p className="mt-6 text-xs italic text-orchid-dim">{footnote}</p>}
    </section>
  );
}

export function NumberField({ label, value, onChange, hint, prefix, suffix, step = "any", min = 0 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  prefix?: string;
  suffix?: string;
  step?: string;
  min?: number;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-white/90">{label}</label>
      {hint && <p className="text-xs text-orchid-dim">{hint}</p>}
      <div
        className={cn(
          "flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-4",
          "focus-within:border-gold/60 focus-within:bg-white/[0.07]",
        )}
      >
        {prefix && <span aria-hidden className="text-sm text-orchid-dim">{prefix}</span>}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-transparent py-3 font-body text-[0.95rem] tabular-nums text-white outline-none placeholder:text-white/30"
          placeholder="Enter a number"
        />
        {suffix && <span aria-hidden className="whitespace-nowrap text-sm text-orchid-dim">{suffix}</span>}
      </div>
    </div>
  );
}

export function Figure({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-gold/80">{label}</p>
      <p
        className={cn(
          "font-body font-bold tabular-nums text-white",
          emphasis ? "text-3xl sm:text-4xl" : "text-xl",
        )}
      >
        {value}
      </p>
    </div>
  );
}
