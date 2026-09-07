import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { humanizeKey } from "@/pages/admin/ui/friendly";

/**
 * Admin design-system primitives — shadcn/ui structure (Radix + Tailwind + CVA)
 * styled against the existing Boss Clinician brand tokens rather than shadcn's
 * default CSS variables. That keeps the admin visually part of the same product
 * as the marketing site and avoids a second, competing token layer.
 */

/* ------------------------------------------------------------------ Button */

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      // §48: solid accent primary, neutral bordered secondary, text tertiary,
      // restrained red danger. Every fill is a token so the same button reads
      // correctly on warm ivory and on charcoal — the previous gold-foil
      // gradient with near-black text was legible in exactly one of the two.
      variant: {
        primary: "bg-accent-solid text-accent-on shadow-console hover:brightness-110 active:brightness-95",
        secondary: "border border-hairline bg-raise text-ink hover:border-accent/45 hover:bg-raise-strong",
        ghost: "text-ink-soft hover:bg-raise hover:text-ink",
        // Kept for the few places that are deliberately brand-gold (the sign-in
        // call to action, the upgrade prompts) rather than console-accent.
        gold: "bg-gold-foil font-bold text-night-deep hover:brightness-105",
        danger: "bg-neg text-white shadow-console hover:brightness-110",
        dangerGhost: "text-neg hover:bg-neg-soft",
        dark: "border border-hairline bg-sand text-ink hover:bg-raise-strong",
      },
      size: {
        sm: "h-9 px-3.5 text-xs [&_svg]:size-4",
        md: "h-11 px-5 text-sm [&_svg]:size-[1.05rem]",
        lg: "h-12 px-7 text-[0.95rem] [&_svg]:size-5",
        icon: "size-10 [&_svg]:size-[1.05rem]",
        iconSm: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

/* -------------------------------------------------------------------- Card */

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Console card: a flat raised surface with a hairline, not the public
        // theme's frosted glass. Backdrop blur behind a 200-row table costs a
        // full-viewport repaint on every scroll frame.
        // §47: 8–14px radius, 1px border, soft shadow. The shadow is a theme
        // variable — one tuned for a near-black page reads as a smudge on ivory.
        "rounded-2xl border border-hairline bg-surface shadow-console",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-hairline/60 px-5 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/[0.12] text-accent">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate font-display text-base text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em]",
  {
    variants: {
      // §13's meaning-carrying palette. `green`/`red`/`gold` keep their names
      // because ~40 call sites pass them, but they now resolve to the muted
      // status tokens rather than to Tailwind's stock saturated families.
      tone: {
        neutral: "border-hairline bg-raise text-ink-soft",
        plum: "border-accent/35 bg-accent-soft text-accent",
        gold: "border-warn/35 bg-warn-soft text-warn",
        green: "border-pos/35 bg-pos-soft text-pos",
        red: "border-neg/35 bg-neg-soft text-neg",
        blue: "border-accent/35 bg-accent-soft text-accent",
        slate: "border-hairline bg-raise text-ink-soft",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Enquiry lifecycle → colour. Kept next to Badge so the mapping has one home. */
export const LEAD_STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  new: "blue",
  contacted: "gold",
  qualified: "green",
  closed: "plum",
  archived: "slate",
};

/**
 * The same lifecycle in the owner's words. The stored values are one-word
 * machine states; she thinks in terms of what she has done about the person,
 * so the badge, the dropdown and the filter pills all read from here rather
 * than capitalising the raw value.
 */
export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "New enquiry",
  contacted: "I've replied",
  qualified: "Good fit",
  closed: "Won",
  archived: "Archived",
};

/** Falls back to a readable version of anything the list above doesn't cover. */
export function leadStatusLabel(status: string): string {
  return LEAD_STATUS_LABEL[status] ?? humanizeKey(status);
}

/* ------------------------------------------------------------- Form fields */

const fieldStyles =
  "w-full rounded-xl border border-hairline bg-raise px-4 text-sm text-ink outline-none transition-all placeholder:text-ink-soft/60 hover:border-ink-soft/35 focus-visible:border-accent focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-accent/20 disabled:opacity-60 disabled:text-ink-soft";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldStyles, "h-11", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldStyles, "py-3 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

/**
 * The one dropdown look, exported because plenty of screens build their options
 * from a list and want a plain `<select>` rather than a component.
 *
 * It used to be declared once per screen — eleven copies, three of which had
 * drifted off the shared field styling and left the chosen value hard to read.
 * A control that appears on twenty screens cannot be a constant at the top of
 * each of them. `.select-field` (index.css) is the part Tailwind cannot express:
 * dropping the native appearance, drawing the arrow back, and colouring the
 * option list the OS renders.
 */
export const selectStyles = cn(fieldStyles, "h-11 cursor-pointer select-field");

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(selectStyles, className)} {...props} />
  ),
);
Select.displayName = "Select";

/**
 * Label + hint + one input.
 *
 * `error` is per-field on purpose: a form-wide "invalid input" banner leaves
 * the owner hunting for which box she got wrong, so screens attach the
 * correction to the box it belongs to and say what to do about it.
 */
/**
 * A labelled form control.
 *
 * The label is associated with its control here rather than at the call site.
 * `htmlFor` was optional and almost nobody passed it, which left every label in
 * the admin console pointing at nothing: visually correct, and silent to a
 * screen reader, on every screen. Fixing it per caller would have meant an id on
 * roughly two hundred controls and would have regressed the first time somebody
 * added one without.
 *
 * So the id is generated when it is not given and injected into the child. A
 * caller that already sets its own `id` keeps it — `htmlFor` still wins, and a
 * control that manages its own identity is not overwritten.
 *
 * The injection only reaches a single element child. A `Field` wrapping several
 * controls (a date range, a pair of radios) has no single thing to point at, and
 * for those the label is rendered as a group caption instead, which is the
 * honest markup for that shape.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;

  const single = isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const existingId = single?.props?.id;
  const controlId = htmlFor ?? (typeof existingId === "string" ? existingId : generatedId);

  const control =
    single && !htmlFor
      ? cloneElement(single, {
          id: controlId,
          // Pointed at the error text so a screen reader reads the reason along
          // with the field, rather than announcing an invalid control and
          // leaving the user to hunt for why.
          ...(error ? { "aria-invalid": true, "aria-describedby": errorId } : {}),
        })
      : children;

  return (
    <div className={className}>
      <label
        htmlFor={single || htmlFor ? controlId : undefined}
        className="mb-1.5 flex items-baseline gap-2 text-[0.8rem] font-semibold text-ink"
      >
        {label}
        {hint && <span className="font-normal text-ink-soft/80">{hint}</span>}
      </label>
      {control}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-neg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------- Page header / misc */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
        )}
        {/* §46 puts the page title at 28–32px. `text-white` here was invisible
            the moment the console gained a light theme. */}
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-raise-strong", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent/[0.10] text-accent [&_svg]:size-6">
        {icon}
      </span>
      <p className="mt-4 font-display text-lg text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-soft">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-neg/30 bg-neg-soft px-4 py-3 text-sm text-neg"
    >
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-neg text-xs font-bold text-white">
        !
      </span>
      <span>{message}</span>
    </div>
  );
}
