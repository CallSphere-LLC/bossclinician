import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";
import { memberRequest } from "@/lib/memberApi";
import { useMember } from "@/hooks/useMember";
import type { OutlineModule } from "@/lib/libraryApi";
import { usePlayerSource } from "./playerSource";
import { courseSearchAccessKey, searchPreviewOutline, type CourseSearchResponse } from "./courseSearch";

type CourseSearchProps = { productSlug: string; modules: OutlineModule[] };

export function CourseSearch(props: CourseSearchProps) {
  const { member } = useMember();
  // Signing into a different account must discard queries, results and requests.
  return <CourseSearchForm key={`${member?.id ?? "preview"}:${props.productSlug}`} {...props} />;
}

function CourseSearchForm({ productSlug, modules }: CourseSearchProps) {
  const { preview, lessonPath } = usePlayerSource();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [found, setFound] = useState<{ query: string; accessKey: string; data: CourseSearchResponse } | null>(null);
  const [error, setError] = useState("");
  const term = query.trim();
  const previewModules = preview ? modules : null;
  const accessKey = courseSearchAccessKey(modules);
  useEffect(() => {
    setFound(null);
    setError("");
    if (!term) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const result = previewModules ? Promise.resolve(searchPreviewOutline(previewModules, term))
        : memberRequest<CourseSearchResponse>(`/member/library/${encodeURIComponent(productSlug)}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
      void result.then((data) => { if (!cancelled) setFound({ query: term, accessKey, data }); })
        .catch(() => { if (!cancelled) setError("Search could not load. Try again."); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [term, productSlug, previewModules, accessKey, retry]);
  // Never show the previous query's results while the next request is pending.
  const data = found?.query === term && found.accessKey === accessKey ? found.data : null;
  const clear = () => { setQuery(""); input.current?.focus(); };
  return (
    <section aria-label="Search this course" className="mb-6">
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-white">Search this course</label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-orchid" />
          <input ref={input} id={id} type="search" value={query} maxLength={160}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") clear(); }}
            aria-describedby={`${id}-hint`} aria-controls={`${id}-results`}
            placeholder="Search lessons and topics"
            className="min-h-11 w-full rounded-xl border border-white/20 bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-orchid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold" />
        </div>
        {query && <button type="button" onClick={clear} className="min-h-11 rounded-xl px-3 text-sm text-orchid hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">Clear search</button>}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs text-orchid">
        {preview ? "Preview searches lesson and module titles." : "Search lesson and module titles, plus text and transcripts in lessons available to you."}
      </p>
      <div id={`${id}-results`}>
        <p role="status" aria-live="polite" className="mt-2 text-sm text-orchid">
          {term && !error && (data ? data.total ? `${data.total} ${data.total === 1 ? "lesson" : "lessons"} found${data.total > data.results.length ? `; showing the first ${data.results.length}. Narrow your search to see more.` : "."}` : "No lessons found. Try another word or clear your search." : "Searching…")}
        </p>
        {term && error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-orchid"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)} className="min-h-11 rounded-lg px-2 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">Retry search</button></div>}
        {term && data && data.results.length > 0 && <ul className="mt-3 max-h-96 overflow-y-auto rounded-xl border border-white/15 divide-y divide-white/10">
          {data.results.map((result) => {
            const content = <><span className="block break-words text-xs text-orchid">{result.moduleTitle}</span><span className="mt-1 block break-words font-medium text-white">{result.title}</span>{result.unlocked ? result.snippet && <span className="mt-1 block whitespace-normal break-words text-sm text-orchid">{result.snippet}</span> : <span className="mt-1 block text-sm text-gold">Locked · {result.unlockLabel || "Not open yet"}</span>}</>;
            return <li key={result.id}>{result.unlocked ? <Link to={lessonPath(productSlug, result.slug)} className="block min-h-11 p-3 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold">{content}</Link> : <div className="p-3">{content}</div>}</li>;
          })}
        </ul>}
      </div>
    </section>
  );
}
