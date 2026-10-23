import { useCallback, useRef, useSyncExternalStore, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from "react";
import { Type } from "lucide-react";
import { toast } from "sonner";
import { htmlToMarkdown, pasteEdit } from "@/lib/htmlToMarkdown";
import { cn } from "@/lib/cn";

/**
 * Pasting into the admin's content editors (QA row 169).
 *
 * Copy from Google Docs, Word or a web page and paste: headings, bold, italic,
 * links and lists come across as the editor's own formatting. Two ways to
 * paste plain words instead, both visible next to the editor:
 *
 *  - the "Keep formatting when I paste" switch (remembered on this browser,
 *    shared by every editor), and
 *  - "Paste as plain text" — the button, or Ctrl+Shift+V (⌘⇧V on a Mac).
 *
 * `useSmartPaste` is for the Markdown textareas (blog, checkout description,
 * newsletters, podcasts, funnels, lesson notes). The rich email editor keeps
 * pasted HTML (sanitised) and uses `usePastePreference` + `isPlainPasteShortcut`
 * + `<PasteOptions>` for the same switch, button and shortcut.
 */

/* ── The shared on/off switch ────────────────────────────────────────────── */

const STORAGE_KEY = "bc.admin.pasteFormatting";
const listeners = new Set<() => void>();
let keepFormatting = readPreference();

function readPreference(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(STORAGE_KEY) !== "plain";
  } catch {
    return true;
  }
}

function setKeepFormatting(next: boolean): void {
  keepFormatting = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "keep" : "plain");
  } catch {
    // Private windows and blocked storage: the switch still works for this visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePastePreference(): { keepFormatting: boolean; setKeepFormatting: (next: boolean) => void } {
  const keep = useSyncExternalStore(subscribe, () => keepFormatting, () => true);
  return { keepFormatting: keep, setKeepFormatting };
}

/** Ctrl+Shift+V, or ⌘⇧V / ⌘⌥⇧V on a Mac: the browsers' own "paste as plain text". */
export function isPlainPasteShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && (event.code === "KeyV" || event.key.toLowerCase() === "v");
}

/** A paste this soon after the shortcut belongs to it. */
const SHORTCUT_WINDOW_MS = 1500;

/** Reads plain text from the clipboard for the button; explains the shortcut when the browser says no. */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) throw new Error("unsupported");
    return await navigator.clipboard.readText();
  } catch {
    toast.info("Your browser didn't let the page read the clipboard. Click where you want the text and press Ctrl+Shift+V (⌘⇧V on a Mac) to paste it as plain text.");
    return null;
  }
}

/**
 * Puts text at the cursor of a textarea the way typing would, so Undo still
 * works and React sees an ordinary change. Falls back to writing the value
 * through `onChange` where the browser refuses `insertText`.
 */
export function insertIntoTextarea(el: HTMLTextAreaElement, text: string, onChange: (value: string) => void): void {
  const edit = pasteEdit(el.value, el.selectionStart, el.selectionEnd, text);
  el.focus();
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, edit.inserted);
  } catch {
    inserted = false;
  }
  if (inserted) return;
  onChange(edit.value);
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    } catch {
      // The textarea was swapped out (preview mode); nothing to place.
    }
  });
}

/* ── Markdown textareas ──────────────────────────────────────────────────── */

export interface SmartPaste {
  /** Spread onto the <Textarea>. */
  textareaProps: {
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onFocus: (event: FocusEvent<HTMLTextAreaElement>) => void;
  };
  /** Spread onto <PasteOptions>. */
  options: { keepFormatting: boolean; setKeepFormatting: (next: boolean) => void; onPastePlain: () => void };
}

/**
 * `onChange` is the editor's own setter for the whole value — only used when
 * the browser will not insert at the cursor itself.
 */
export function useSmartPaste(onChange: (value: string) => void): SmartPaste {
  const { keepFormatting: keep, setKeepFormatting: setKeep } = usePastePreference();
  const target = useRef<HTMLTextAreaElement | null>(null);
  const shortcutAt = useRef(0);
  const change = useRef(onChange);
  change.current = onChange;

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      target.current = event.currentTarget;
      const plain = !keep || Date.now() - shortcutAt.current < SHORTCUT_WINDOW_MS;
      shortcutAt.current = 0;
      // A textarea's own paste is already plain text.
      if (plain) return;
      const html = event.clipboardData.getData("text/html");
      if (!html) return;
      const { markdown, formatted } = htmlToMarkdown(html);
      // Nothing worth keeping (plain words, or only an image): let the browser paste as usual.
      if (!formatted || !markdown) return;
      event.preventDefault();
      insertIntoTextarea(event.currentTarget, markdown, (value) => change.current(value));
    },
    [keep],
  );

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isPlainPasteShortcut(event)) shortcutAt.current = Date.now();
  }, []);

  const onFocus = useCallback((event: FocusEvent<HTMLTextAreaElement>) => {
    target.current = event.currentTarget;
  }, []);

  const onPastePlain = useCallback(() => {
    const el = target.current;
    if (!el || !el.isConnected) {
      toast.info("Click in the box where the text should go first, then press Paste as plain text.");
      return;
    }
    void readClipboardText().then((text) => {
      if (text) insertIntoTextarea(el, text, (value) => change.current(value));
    });
  }, []);

  return {
    textareaProps: { onPaste, onKeyDown, onFocus },
    options: { keepFormatting: keep, setKeepFormatting: setKeep, onPastePlain },
  };
}

/* ── The visible controls ────────────────────────────────────────────────── */

/** "Keep formatting when I paste" + "Paste as plain text", shown with an editor's toolbar. */
export function PasteOptions({
  keepFormatting: keep,
  setKeepFormatting: setKeep,
  onPastePlain,
  className,
}: {
  keepFormatting: boolean;
  setKeepFormatting: (next: boolean) => void;
  onPastePlain: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft", className)}>
      <label
        className="inline-flex cursor-pointer items-center gap-1.5"
        title="On: headings, bold, italic, links and lists you copy from Google Docs, Word or a web page are kept. Off: only the words are pasted."
      >
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
          className="size-3.5 rounded border-hairline text-plum focus-visible:ring-plum/30"
        />
        Keep formatting when I paste
      </label>
      <button
        type="button"
        // Keeps the cursor where it was in the editor while the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPastePlain}
        title="Paste what you copied as plain words, without its formatting. Shortcut: Ctrl+Shift+V (⌘⇧V on a Mac)."
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-plum hover:bg-white/[0.06]"
      >
        <Type className="size-3.5" aria-hidden="true" />
        Paste as plain text
      </button>
      <span className="hidden sm:inline">or Ctrl+Shift+V</span>
    </div>
  );
}
