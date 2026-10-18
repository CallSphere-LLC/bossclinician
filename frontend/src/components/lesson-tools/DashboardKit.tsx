import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CloudOff, Download, Eye, Loader2, Printer, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import type { SaveStatus } from "./useToolState";

/**
 * Building blocks for the multi-tab lesson dashboards (Boss Move Exit Planner,
 * Practice Elevation, Boardroom CEO, Practice Reset Snapshot).
 *
 * Everything is drawn with the site's theme tokens (`text-white`, `orchid`,
 * `gold`, `plum`, `bg-white/[0.0x]`), which site-theme.css re-maps for the
 * light theme, so the dashboards follow whichever theme the member is on. The
 * prototypes' sage is kept as the one accent that is not a token — progress
 * fills and "done" markers — because it reads on both backgrounds.
 *
 * Figures use the body font in bold with tabular numerals, never the display
 * serif; the serif is for headings only.
 */

export const SAGE = "#547376";

/* ------------------------------------------------------------------ frame */

export function DashboardFrame({
  eyebrow,
  title,
  subtitle,
  status,
  savedAt,
  actions,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  status: SaveStatus;
  savedAt?: string | null;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 rounded-2xl border border-gold/25 bg-white/[0.03] p-4 shadow-glass sm:p-7"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
          <h2 className="mt-2 font-display text-2xl text-white sm:text-[1.75rem]">{title}</h2>
          {subtitle && <div className="mt-1.5 text-sm leading-relaxed text-orchid">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>}
      </div>
      <SaveBadge status={status} savedAt={savedAt ?? null} />
      <div className="mt-5 flex min-w-0 flex-col gap-5">{children}</div>
      {footer && (
        <p className="mt-7 border-t border-white/10 pt-4 text-xs leading-relaxed text-orchid-dim">{footer}</p>
      )}
    </section>
  );
}

const STATUS_COPY: Record<SaveStatus, string> = {
  loading: "Loading your saved entries…",
  idle: "Your entries save to your account automatically.",
  saving: "Saving…",
  saved: "Saved to your account",
  error: "Could not save just now. Retrying — keep this page open.",
  offline: "Your saved entries could not be loaded, so changes here are not being saved. Reload the page to try again.",
  preview: "Preview: entries are not saved.",
  readonly: "Viewing as this member: read-only, nothing is saved.",
};

export function SaveBadge({ status, savedAt }: { status: SaveStatus; savedAt: string | null }) {
  const icon =
    status === "saving" || status === "loading" ? (
      <Loader2 aria-hidden className="size-3.5 animate-spin" />
    ) : status === "saved" || status === "idle" ? (
      <Check aria-hidden className="size-3.5" />
    ) : status === "error" ? (
      <AlertTriangle aria-hidden className="size-3.5" />
    ) : status === "offline" ? (
      <CloudOff aria-hidden className="size-3.5" />
    ) : (
      <Eye aria-hidden className="size-3.5" />
    );
  const warn = status === "error" || status === "offline";
  const when =
    status === "saved" && savedAt
      ? ` · ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "";
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "mt-3 inline-flex items-center gap-1.5 text-xs print:hidden",
        warn ? "text-gold" : "text-orchid-dim",
      )}
    >
      {icon}
      {STATUS_COPY[status]}
      {when}
    </p>
  );
}

/* ------------------------------------------------------------------- tabs */

export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: readonly { id: K; label: string }[];
  active: K;
  onChange: (id: K) => void;
  label: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto pb-1">
      <div role="tablist" aria-label={label} className="flex w-max gap-2 px-1">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={cn(
                "min-h-[2.5rem] whitespace-nowrap rounded-full border px-4 text-[0.8rem] font-semibold transition-colors duration-300",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                selected
                  ? "border-gold/70 bg-gold/[0.16] text-white"
                  : "border-white/15 bg-white/[0.03] text-orchid hover:border-gold/40 hover:text-white",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- panels */

export function Panel({
  title,
  intro,
  eyebrow,
  children,
  className,
}: {
  title?: ReactNode;
  intro?: ReactNode;
  eyebrow?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5", className)}>
      {eyebrow && <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-gold/90">{eyebrow}</p>}
      {title && <h3 className={cn("text-base font-semibold text-white", eyebrow && "mt-1")}>{title}</h3>}
      {intro && <div className="mt-1.5 text-sm leading-relaxed text-orchid">{intro}</div>}
      {children && <div className={cn((title || intro) && "mt-4", "flex min-w-0 flex-col gap-4")}>{children}</div>}
    </div>
  );
}

export function Grid({ cols = 2, children, className }: { cols?: 2 | 3 | 4; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 sm:gap-4",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-3",
        cols === 4 && "grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A headline figure. The value is body font, bold, tabular. */
export function Tile({ label, value, hint, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-xl border p-3.5 sm:p-4",
        emphasis ? "border-gold/40 bg-gold/[0.07]" : "border-white/10 bg-white/[0.03]",
      )}
    >
      <p className="text-[0.72rem] font-semibold leading-snug text-orchid">{label}</p>
      <p className="break-words font-body text-xl font-bold tabular-nums text-white sm:text-2xl">{value}</p>
      {hint && <p className="text-[0.7rem] leading-snug text-orchid-dim">{hint}</p>}
    </div>
  );
}

const CALLOUT_TONE = {
  sage: "border-l-[#547376] bg-[#547376]/[0.10]",
  plum: "border-l-plum bg-plum/[0.10]",
  gold: "border-l-gold bg-gold/[0.08]",
  rose: "border-l-rose-400 bg-rose-400/[0.08]",
} as const;

export function Callout({ tone = "sage", children, className }: { tone?: keyof typeof CALLOUT_TONE; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border-l-4 px-4 py-3 text-sm leading-relaxed text-orchid", CALLOUT_TONE[tone], className)}>
      {children}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-plum/40 bg-plum/[0.14] px-2.5 py-1 text-[0.7rem] font-bold text-white/90">
      {children}
    </span>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-2.5 overflow-hidden rounded-full bg-white/10"
    >
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: SAGE }} />
    </div>
  );
}

/* ----------------------------------------------------------------- fields */

function FieldShell({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8rem] font-semibold leading-snug text-white/90">
        {label}
      </label>
      {children}
      {hint && <p className="text-[0.72rem] leading-snug text-orchid-dim">{hint}</p>}
    </div>
  );
}

/**
 * A number box that can be emptied while typing. It keeps its own text and
 * reports a number (or null for empty) upwards, so "0" does not snap back into
 * a box the member has just cleared.
 */
export function NumField({
  label,
  hint,
  value,
  onChange,
  prefix,
  suffix,
  min = 0,
  max,
  step = "any",
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: string | number;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  // Follow changes made elsewhere (a restored backup, a reset) without
  // fighting the box while the member types into it.
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    const external = value === undefined ? null : value;
    if (parsed !== external && !(parsed !== null && Number.isNaN(parsed))) {
      setText(external === null ? "" : String(external));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div
        className={cn(
          "flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3.5",
          "focus-within:border-gold/60 focus-within:bg-white/[0.07]",
        )}
      >
        {prefix && <span aria-hidden className="text-sm text-orchid-dim">{prefix}</span>}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            if (raw.trim() === "") onChange(null);
            else {
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(n);
            }
          }}
          className="w-full min-w-0 bg-transparent py-2.5 font-body text-[0.95rem] tabular-nums text-white outline-none placeholder:text-white/30"
        />
        {suffix && <span aria-hidden className="whitespace-nowrap text-sm text-orchid-dim">{suffix}</span>}
      </div>
    </FieldShell>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(luxeControlClass, "py-2.5", type === "date" && "[color-scheme:inherit]")}
      />
    </FieldShell>
  );
}

export function AreaField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(luxeControlClass, "resize-y py-2.5 leading-relaxed")}
      />
    </FieldShell>
  );
}

export function SelectField<V extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: V | "";
  onChange: (value: V) => void;
  options: readonly { value: V; label: string }[];
  placeholder?: string;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as V)}
        className={cn(
          luxeControlClass,
          "py-2.5 [&>option]:bg-night-raised [&>option]:text-ink",
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-[2.75rem] cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm leading-snug transition-colors duration-300",
        checked ? "border-[#547376]/60 bg-[#547376]/[0.12] text-white" : "border-white/12 bg-white/[0.03] text-orchid hover:border-white/25",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[#547376]"
      />
      <span className="flex-1">{children}</span>
    </label>
  );
}

/* ---------------------------------------------------------------- actions */

export function ActionButton({
  onClick,
  children,
  icon,
  primary,
  disabled,
  tone,
}: {
  onClick: () => void;
  children: ReactNode;
  icon?: "download" | "upload" | "print";
  primary?: boolean;
  disabled?: boolean;
  tone?: "warn";
}) {
  const Icon = icon === "download" ? Download : icon === "upload" ? Upload : icon === "print" ? Printer : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-full border px-4 text-[0.8rem] font-semibold transition-colors duration-300 print:hidden",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        "disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "border-gold/70 bg-gold/[0.18] text-white hover:bg-gold/[0.28]"
          : tone === "warn"
            ? "border-rose-400/40 bg-transparent text-rose-400 hover:bg-rose-400/[0.08]"
            : "border-white/20 bg-white/[0.03] text-white/90 hover:border-gold/50 hover:text-white",
      )}
    >
      {Icon && <Icon aria-hidden className="size-4" />}
      {children}
    </button>
  );
}

/** "Restore backup": a button that opens a file picker for a .json file. */
export function RestoreButton({ onFile, children = "Restore backup" }: { onFile: (data: unknown) => void; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <ActionButton icon="upload" onClick={() => input.current?.click()}>
        {children}
      </ActionButton>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            onFile(JSON.parse(await file.text()));
          } catch {
            onFile(undefined);
          }
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------- utilities */

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const REPORT_STYLE = `body{font-family:Arial,Helvetica,sans-serif;max-width:780px;margin:32px auto;padding:0 18px;line-height:1.55;color:#20283a}
h1,h2,h3{color:#313d5a;font-family:Georgia,serif;font-weight:500}h1{font-size:26px;margin:4px 0 6px}h2{font-size:19px;margin:22px 0 8px}h3{font-size:15px;margin:14px 0 6px}
small,.muted{color:#6a7080}section{border-top:1px solid #e4e4e9;padding:10px 0;break-inside:avoid}table{width:100%;border-collapse:collapse;font-size:13px}
td,th{text-align:left;border-bottom:1px solid #ebeaf0;padding:7px 6px;vertical-align:top}th{background:#f5f3f9;color:#313d5a}td.num{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
ul,ol{padding-left:20px}.note{border-left:4px solid #547376;background:#f0f5f3;padding:10px 14px;border-radius:6px}`;

/** A standalone, printable HTML document. */
export function reportDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${REPORT_STYLE}</style></head><body>${bodyHtml}</body></html>`;
}

/**
 * Print / Save as PDF without the lesson page around it: the report is laid
 * out in a hidden frame and that frame is printed.
 */
export function printReport(title: string, bodyHtml: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = reportDocument(title, bodyHtml);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.append(frame);
}

/** Rows of label / value for a report table. */
export function reportRows(rows: readonly (readonly [string, string])[]): string {
  return `<table><tbody>${rows
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`)
    .join("")}</tbody></table>`;
}
