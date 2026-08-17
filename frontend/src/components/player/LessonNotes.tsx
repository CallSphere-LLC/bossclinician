import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, NotebookPen } from "lucide-react";
import { LuxeTextarea } from "@/components/luxe/LuxeField";
import { MemberApiError } from "@/lib/memberApi";
import { libraryApi } from "@/lib/libraryApi";

/** Long enough that a sentence is one write, short enough to survive a tab close. */
const AUTOSAVE_DELAY_MS = 1200;

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The member's private notebook for one lesson.
 *
 * Autosaving, because a notebook with a Save button is a notebook that loses
 * what somebody typed while a video was playing. The debounce is the whole
 * mechanism: keystrokes coalesce into one write, and the write also fires when
 * the field loses focus and when the tab is hidden, which is how a note survives
 * being backgrounded on a phone.
 *
 * These rows are read by nobody else. No admin screen in this codebase selects
 * `lesson_notes`, and the wording here says so plainly — people write things
 * about their own practice, their clients and their money in a course notebook
 * that they would not write anywhere someone else can read.
 */
export function LessonNotes({ lessonId }: { lessonId: number }) {
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  // The typed value and the persisted value both live in refs so the debounce
  // timer and the unmount flush read what is true *now*, not what was true when
  // the callback was created.
  const typed = useRef("");
  const persisted = useRef("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void libraryApi
      .getNote(lessonId)
      .then((note) => {
        if (cancelled) return;
        setBody(note.body);
        setEnabled(note.notesEnabled);
        typed.current = note.body;
        persisted.current = note.body;
        setState("idle");
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError("We could not open your notes just now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const persist = useCallback(async () => {
    const next = typed.current;
    if (next === persisted.current) return;

    setState("saving");
    try {
      const saved = await libraryApi.saveNote(lessonId, next);
      persisted.current = saved.body;
      setState("saved");
      setError("");
    } catch (err) {
      setState("error");
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not save that note. Your text is still here — try again in a moment.",
      );
    }
  }, [lessonId]);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void persist();
    }, AUTOSAVE_DELAY_MS);
  }, [persist]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    void persist();
  }, [persist]);

  // A phone backgrounding the tab is the most common way a half-typed note is
  // lost, and it never fires `beforeunload`.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  if (!enabled) return null;

  return (
    <section
      aria-labelledby={`notes-heading-${lessonId}`}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <h2
          id={`notes-heading-${lessonId}`}
          className="flex items-center gap-2.5 font-display text-base text-white"
        >
          <NotebookPen aria-hidden className="size-4 text-gold" />
          Your notes
        </h2>
        <SaveStatus state={state} />
      </div>

      <p className="mt-1.5 text-xs text-orchid-faint">
        Private to you. Nobody else — including Yvette — can read these.
      </p>

      <div className="mt-3.5">
        <LuxeTextarea
          label="Notes for this lesson"
          rows={6}
          value={body}
          disabled={loading}
          placeholder={loading ? "Opening your notes…" : "What do you want to remember from this?"}
          error={error || undefined}
          onChange={(event) => {
            setBody(event.target.value);
            typed.current = event.target.value;
            setState("idle");
            schedule();
          }}
          onBlur={flush}
          className="min-h-[9rem]"
        />
      </div>
    </section>
  );
}

/**
 * `aria-live` on the wrapper rather than on the changing text, because a region
 * that is inserted and removed is not announced — only one that is present and
 * whose contents change.
 */
function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p aria-live="polite" className="flex shrink-0 items-center gap-1.5 text-xs text-orchid-faint">
      {state === "saving" && (
        <>
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          Saving…
        </>
      )}
      {state === "saved" && (
        <>
          <Check aria-hidden className="size-3.5 text-gold" />
          Saved
        </>
      )}
    </p>
  );
}
