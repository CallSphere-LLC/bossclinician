import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Package, Search, Ticket, User, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { consoleApi, type SearchHit } from "@/lib/consoleApi";

/**
 * The header's global search — Part II §10.
 *
 * A search box lived here before, wired to nothing: it took what she typed and
 * pressing Enter did nothing at all. That is worse than no box, so it was
 * removed. This one is backed by `/admin/search`, which answers over contacts,
 * orders, products and offers and filters each source against the caller's
 * permissions.
 *
 * Implemented as a combobox rather than a form: the value of a search box in a
 * back office is jumping straight to the record, and making her press Enter to
 * reach a results page she then has to read is one screen too many.
 *
 * Keyboard is the point (§51): ↑/↓ move, Enter opens, Escape closes and
 * returns focus to the input, and ⌘K / Ctrl-K focuses it from anywhere.
 */

const KIND_ICON = {
  contact: User,
  order: CreditCard,
  product: Package,
  offer: Ticket,
} as const;

const KIND_LABEL = {
  contact: "Contact",
  order: "Order",
  product: "Product",
  offer: "Offer",
} as const;

export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const listId = useId();

  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* ⌘K / Ctrl-K from anywhere in the console. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Debounced lookup. The previous request is aborted rather than left to
     resolve, so a fast typist cannot have an early, shorter query land last
     and overwrite the results for what they actually typed. */
  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      consoleApi
        .search(query, controller.signal)
        .then((result) => {
          setHits(result.hits);
          setActive(0);
          setLoading(false);
        })
        .catch((err: unknown) => {
          // An aborted request is the expected path on every keystroke.
          if ((err as { name?: string })?.name === "AbortError") return;
          setHits([]);
          setLoading(false);
        });
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term]);

  /* Close when focus or the pointer leaves the whole control. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      setTerm("");
      setHits([]);
      navigate(hit.to);
    },
    [navigate],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || hits.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    }
  };

  const showPanel = open && term.trim().length >= 2;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search contacts, orders, products and offers"
          placeholder="Search contacts, orders, products…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-xl border border-hairline bg-raise pl-9 pr-16 text-sm text-ink outline-none transition-colors placeholder:text-ink-soft/70 focus-visible:border-accent focus-visible:bg-surface"
        />
        {term ? (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              inputRef.current?.focus();
            }}
            aria-label="Clear the search"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-soft hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        ) : (
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-0.5 font-body text-[0.62rem] font-semibold text-ink-soft"
          >
            ⌘K
          </kbd>
        )}
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-xl border border-hairline bg-surface-raised shadow-console-pop">
          {loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-soft">Looking…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-soft">
              Nothing matches &ldquo;{term.trim()}&rdquo;.
            </p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-[22rem] overflow-y-auto py-1">
              {hits.map((hit, index) => {
                const Icon = KIND_ICON[hit.kind];
                return (
                  <li key={`${hit.kind}-${hit.id}`} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        index === active ? "bg-raise" : "hover:bg-raise",
                      )}
                    >
                      <span
                        aria-hidden
                        className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent [&_svg]:size-3.5"
                      >
                        <Icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.85rem] font-medium text-ink">
                          {hit.title}
                        </span>
                        <span className="block truncate text-[0.73rem] text-ink-soft">
                          {hit.subtitle}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.66rem] uppercase tracking-[0.08em] text-ink-soft">
                        {KIND_LABEL[hit.kind]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
