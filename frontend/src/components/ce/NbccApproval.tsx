import { cn } from "@/lib/cn";
import { NBCC_ACEP_LOGO, NBCC_APPROVAL_STATEMENT } from "@/content/nbcc";

/**
 * The NBCC approval statement with the ACEP logo beside it (NBCC directive A).
 *
 * `text` lets a page keep its own longer paragraph when that paragraph already
 * contains the statement (e.g. it adds program hours or the policy link); it
 * must include NBCC_APPROVAL_STATEMENT verbatim. The logo file has a white
 * ground, so it sits on a small light tile that reads on dark and light themes.
 */
export function NbccApproval({
  text = NBCC_APPROVAL_STATEMENT,
  align = "center",
  className,
  textClassName,
}: {
  text?: string;
  align?: "center" | "start";
  className?: string;
  textClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-5",
        align === "center" ? "sm:justify-center" : "sm:justify-start",
        className,
      )}
      data-nbcc-approval
    >
      <span className="flex-none rounded-md bg-white p-1.5 shadow-sm ring-1 ring-black/5">
        <img
          src={NBCC_ACEP_LOGO.src}
          alt={NBCC_ACEP_LOGO.alt}
          width={NBCC_ACEP_LOGO.width}
          height={NBCC_ACEP_LOGO.height}
          loading="lazy"
          decoding="async"
          className="block size-14 sm:size-16"
        />
      </span>
      <p
        className={cn(
          "text-pretty text-xs leading-[1.8] text-orchid",
          align === "center" ? "text-center sm:text-left" : "text-left",
          textClassName,
        )}
      >
        {text}
      </p>
    </div>
  );
}
