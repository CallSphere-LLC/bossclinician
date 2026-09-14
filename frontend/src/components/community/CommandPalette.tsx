import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Hash, Loader2, MessageSquare, Search, User } from "lucide-react";
import { communityApi, type CommunitySearchResults } from "@/lib/communityApi";
import { cn } from "@/lib/cn";

/**
 * Community search, on Cmd-K (2.11).
 *
 * A palette rather than a search page because the question it answers is
 * "where is that thing?" and the answer is a jump, not a results screen. One
 * request returns channels, people and posts together — three requests would
 * make the list flicker as each landed.
 *
 * Every result is already scoped by the server: private channels, access-group
 * channels and hidden posts never appear. The palette does no filtering of its
 * own, because a client that decided what to show would be a client that could
 * be persuaded to show more.
 */
export function CommandPalette({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<CommunitySearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd-K on a Mac, Ctrl-K elsewhere, and Escape to leave. Bound to the window
  // so it works wherever the reader's focus happens to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setTerm("");
      setResults(null);
    }
  }, [open]);

  const run = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults(null);
        return;
      }
      setBusy(true);
      try {
        setResults(await communityApi.search(slug, q.trim()));
      } catch {
        setResults(null);
      } finally {
        setBusy(false);
      }
    },
    [slug],
  );

  // Debounced, because this fires on every keystroke and the query touches
  // three tables. 220ms is below the point a typist notices and well above the
  // rate at which they produce characters.
  useEffect(() => {
    const timer = window.setTimeout(() => void run(term), 220);
    return () => window.clearTimeout(timer);
  }, [term, run]);

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const nothing =
    results !== null &&
    results.channels.length === 0 &&
    results.people.length === 0 &&
    results.posts.length === 0;

  return (
    <>
      {/* The affordance. Nobody discovers a keyboard shortcut that is not
          written down anywhere, so the shortcut is printed on the button. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full border border-white/12 px-4",
          "text-xs font-semibold uppercase tracking-[0.12em] text-white/55",
          "transition-colors hover:border-white/25 hover:text-white",
        )}
      >
        <Search aria-hidden className="size-3.5" />
        Search
        <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-sans text-[0.6rem] normal-case text-white/45">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search this community"
          className="fixed inset-0 z-50 bg-black/70 p-4 pt-[12vh]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-night-deep">
            <div className="flex items-center gap-3 border-b border-white/10 px-4">
              <Search aria-hidden className="size-4 shrink-0 text-white/40" />
              <input
                ref={inputRef}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search channels, people and posts…"
                aria-label="Search this community"
                className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
              />
              {busy && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-gold" />}
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-2">
              {term.trim().length < 2 && (
                <p className="px-3 py-4 text-sm text-white/45">
                  Type at least two letters.
                </p>
              )}

              {nothing && (
                <p className="px-3 py-4 text-sm text-white/45">
                  Nothing matched “{results?.query}”.
                </p>
              )}

              {results && results.channels.length > 0 && (
                <Group label="Channels">
                  {results.channels.map((channel) => (
                    <Row
                      key={channel.slug}
                      icon={<Hash aria-hidden className="size-3.5" />}
                      title={channel.name}
                      subtitle={channel.description}
                      onSelect={() => go(channel.href)}
                    />
                  ))}
                </Group>
              )}

              {results && results.people.length > 0 && (
                <Group label="People">
                  {results.people.map((person) => (
                    <Row
                      key={person.memberId}
                      icon={<User aria-hidden className="size-3.5" />}
                      title={person.name}
                      subtitle={person.headline}
                      onSelect={() => go(person.href)}
                    />
                  ))}
                </Group>
              )}

              {results && results.posts.length > 0 && (
                <Group label="Posts">
                  {results.posts.map((post) => (
                    <Row
                      key={post.id}
                      icon={<MessageSquare aria-hidden className="size-3.5" />}
                      title={post.title || post.snippet.slice(0, 60) || "(no words)"}
                      subtitle={`${post.authorName} in ${post.channelName}`}
                      onSelect={() => go(post.href)}
                    />
                  ))}
                </Group>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-white/35">
        {label}
      </p>
      <ul>{children}</ul>
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="shrink-0 text-white/40">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-white/50">{subtitle}</span>
          )}
        </span>
      </button>
    </li>
  );
}
