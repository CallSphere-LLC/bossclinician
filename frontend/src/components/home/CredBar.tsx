const items = [
  "Multi-6-Figure Group Practice Owner",
  "Doctoral Candidate",
  "LCSW",
  "Private Practice Strategist",
];

export function CredBar() {
  return (
    <div className="border-b border-white/[0.06] bg-ink px-5 py-4" aria-label="Credentials">
      <div className="mx-auto flex max-w-8xl flex-wrap items-center justify-center gap-3 px-3">
        {items.map((item, i) => (
          <span key={item} className="flex items-center gap-3">
            {i > 0 && (
              <span aria-hidden className="text-[0.6rem] text-gold">
                ◆
              </span>
            )}
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-lilac/80">
              {item}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
