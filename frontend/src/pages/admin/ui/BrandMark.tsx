/**
 * The Boss Clinician mark — a rounded clinical cross.
 *
 * Drawn rather than shipped as a PNG so it stays crisp at any size, takes no
 * request, and inherits `currentColor`, which is what lets the same mark sit on
 * the ivory sign-in panel and the charcoal one without a second asset.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="Boss Clinician"
    >
      {/*
        The twelve vertices of a plus, closed, with round joins doing the
        corner radii. Written as a polygon rather than as arcs because the
        eight convex and four concave corners need different radii, and a
        hand-authored arc path that gets one of them backwards reads as a
        rounded square with dents — which is exactly what the first attempt
        drew.
      */}
      <polygon
        points="23,5 41,5 41,23 59,23 59,41 41,41 41,59 23,59 23,41 5,41 5,23 23,23"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark plus the wordmark, as it appears on the sign-in screen. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        <BrandMark className="size-[3.6rem] shrink-0 text-accent" />
        <div className="min-w-0 leading-none">
          <p className="font-display text-[2.75rem] font-semibold leading-none tracking-[0.02em] text-ink">
            BOSS
          </p>
          <p className="mt-2 text-[0.95rem] font-semibold uppercase leading-none tracking-[0.38em] text-accent">
            Clinician
          </p>
        </div>
      </div>
    </div>
  );
}
