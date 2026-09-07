import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
  FileText,
  GraduationCap,
  GripVertical,
  Headphones,
  HelpCircle,
  Layers,
  Paperclip,
  Pencil,
  Trash2,
  Video,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { CourseLesson, CourseModule, CourseQuiz } from "@/types/admin";
import { Badge, Button } from "@/pages/admin/ui/primitives";
import { pluralize } from "@/pages/admin/ui/friendly";

/**
 * The course outline — Course → Module → Content.
 *
 *   📚 Module 1 — Foundations                 + Add   Edit  Delete   ⌄
 *        🎬 Welcome                Video       PUBLISHED     Edit  Delete
 *        📄 What We Will Cover     Lesson      PUBLISHED     Edit  Delete
 *        ❓ Foundations Quiz       Quiz        DRAFT         Edit
 *
 * Two levels the admin can hold in their head. There is no Submodule: those
 * records still exist — migration 024 promoted them to Modules rather than
 * deleting anything — but the level is gone from the interface.
 *
 * Only Modules expand. Content items are leaves: clicking a title or its Edit
 * action opens the editor, and nothing unfolds inside the outline.
 *
 * Reordering is drag-and-drop against the existing single-transaction
 * endpoint. The handle is also a real button that answers the arrow keys,
 * because native HTML5 drag is unreachable from a keyboard and reordering must
 * not become mouse-only.
 */

export type AddKind = "module" | "lesson" | "video" | "audio" | "resource" | "quiz";
export type MoveKind = "module" | "lesson" | "quiz";

export interface DragPayload {
  kind: MoveKind;
  id: number;
  /** The module it sits in — null for a module itself. */
  parentId: number | null;
}

export interface OutlineHandlers {
  onAdd: (kind: AddKind, moduleId?: number) => void;
  onEditModule: (mod: CourseModule) => void;
  onDeleteModule: (mod: CourseModule) => void;
  onEditLesson: (moduleId: number, lesson: CourseLesson) => void;
  onDeleteLesson: (lesson: CourseLesson) => void;
  onEditQuiz: (quiz: CourseQuiz) => void;
  /** Move the held item to `toIndex` among its siblings. */
  onReorder: (payload: DragPayload, toIndex: number) => void;
  /** Keyboard equivalent, from the drag handle. */
  onNudge: (payload: DragPayload, direction: -1 | 1) => void;
  /** Key of the item just created — brought into view and briefly highlighted. */
  highlightId?: string | null;
}

/* --------------------------------------------------------- Content types */

/**
 * How each content type is shown.
 *
 * `course_lessons.content_type` already carries these values, so the icon and
 * the label are read from the record rather than guessed — a lesson saved as
 * audio looks like audio everywhere it appears.
 */
const CONTENT_TYPES = {
  video: { label: "Video", Icon: Video },
  audio: { label: "Audio", Icon: Headphones },
  pdf: { label: "Resource", Icon: Paperclip },
  embed: { label: "Embed", Icon: Video },
  assessment: { label: "Assessment", Icon: HelpCircle },
  text: { label: "Lesson", Icon: FileText },
} as const;

type ContentSpec = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

function contentTypeOf(lesson: CourseLesson): ContentSpec {
  const key = (lesson.contentType ||
    (lesson.videoUrl ? "video" : "text")) as keyof typeof CONTENT_TYPES;
  return CONTENT_TYPES[key] ?? CONTENT_TYPES.text;
}

/* ------------------------------------------------------------ Add content */

const ADD_ITEMS: { kind: AddKind; label: string; hint: string; Icon: typeof Layers }[] = [
  { kind: "module", label: "Module", hint: "A major section of the course", Icon: Layers },
  { kind: "lesson", label: "Lesson", hint: "Written content", Icon: FileText },
  { kind: "video", label: "Video", hint: "A video students watch", Icon: Video },
  { kind: "quiz", label: "Quiz / Test", hint: "Questions with a result", Icon: HelpCircle },
  { kind: "audio", label: "Audio", hint: "Something students listen to", Icon: Headphones },
  {
    kind: "resource",
    label: "Download / Resource",
    hint: "A file students can keep",
    Icon: Paperclip,
  },
];

export function AddContentMenu({
  onAdd,
  moduleId,
  label = "Add Content",
  scope = "course",
  size = "sm",
  variant,
}: {
  onAdd: (kind: AddKind, moduleId?: number) => void;
  moduleId?: number;
  label?: string;
  /** Inside a module, "Module" is not offered — content goes in this one. */
  scope?: "course" | "module";
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const items = scope === "module" ? ADD_ITEMS.filter((i) => i.kind !== "module") : ADD_ITEMS;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant={variant ?? (scope === "course" ? "primary" : "ghost")} size={size}>
          <span aria-hidden className="text-[1.1em] leading-none">+</span>
          {label}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[17.5rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.kind}
              onSelect={() => onAdd(item.kind, moduleId)}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
            >
              <item.Icon aria-hidden className="size-4 shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-[0.7rem] text-ink-soft">{item.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------------------------------------- Drag handle */

function DragHandle({
  label,
  onNudge,
  onDragStart,
}: {
  label: string;
  onNudge: (direction: -1 | 1) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      aria-label={`Reorder ${label}. Use the up and down arrow keys to move it.`}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onNudge(-1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          onNudge(1);
        }
      }}
      className="grid size-6 shrink-0 cursor-grab place-items-center rounded text-ink-soft/45 transition-colors hover:text-ink-soft active:cursor-grabbing"
    >
      <GripVertical aria-hidden className="size-4" />
    </button>
  );
}

function PublishBadge({ published }: { published: boolean }) {
  return <Badge tone={published ? "green" : "slate"}>{published ? "Published" : "Draft"}</Badge>;
}

/* ---------------------------------------------------------------- Content */

/** A lesson, video, audio, resource or quiz. A leaf: nothing expands. */
function ContentRow({
  icon,
  typeLabel,
  title,
  meta,
  published,
  onOpen,
  onDelete,
  drag,
  highlighted,
}: {
  icon: ReactNode;
  typeLabel: string;
  title: string;
  meta: string;
  published: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  drag: {
    label: string;
    onNudge: (d: -1 | 1) => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isOver: boolean;
  };
  highlighted: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);

  /* Bring a newly created item into view rather than leaving the admin to
     hunt for what they just made. */
  useLayoutEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <li
      ref={ref}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2 transition-colors hover:bg-raise",
        drag.isOver && "ring-2 ring-accent/60",
        highlighted && "bg-accent-soft ring-2 ring-accent/50",
      )}
    >
      <DragHandle label={drag.label} onNudge={drag.onNudge} onDragStart={drag.onDragStart} />
      <span className="shrink-0 text-ink-soft">{icon}</span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[0.88rem] font-medium text-ink">{title}</span>
        <span className="block truncate text-[0.74rem] text-ink-soft">
          {[typeLabel, meta].filter(Boolean).join(" · ")}
        </span>
      </button>
      <PublishBadge published={published} />
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="iconSm" onClick={onOpen} aria-label={`Edit ${title}`}>
          <Pencil />
        </Button>
        {onDelete && (
          <Button
            variant="dangerGhost"
            size="iconSm"
            onClick={onDelete}
            aria-label={`Delete ${title}`}
          >
            <Trash2 />
          </Button>
        )}
      </span>
    </li>
  );
}

/* ---------------------------------------------------------------- Module */

function ModuleCard({
  mod,
  handlers,
  open,
  onToggle,
  drag,
  highlighted,
  children,
}: {
  mod: CourseModule;
  handlers: OutlineHandlers;
  open: boolean;
  onToggle: () => void;
  drag: {
    onNudge: (d: -1 | 1) => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    isOver: boolean;
  };
  highlighted: boolean;
  children: ReactNode;
}) {
  const items = mod.lessons.length + (mod.quizzes?.length ?? 0);
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);

  /*
   * Collapsing shortens the page; near the bottom the browser clamps the
   * scroll position and the whole view lurches. The module's distance from the
   * top of the viewport is captured before the toggle and restored after
   * layout — in useLayoutEffect, so it happens before paint rather than as a
   * visible correction.
   */
  const toggle = () => {
    anchor.current = ref.current?.getBoundingClientRect().top ?? null;
    onToggle();
  };

  useLayoutEffect(() => {
    if (anchor.current === null) return;
    const top = ref.current?.getBoundingClientRect().top;
    if (top !== undefined) {
      const drift = top - anchor.current;
      if (drift !== 0) window.scrollBy(0, drift);
    }
    anchor.current = null;
  }, [open]);

  useLayoutEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  return (
    <div
      ref={ref}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn(
        "overflow-hidden rounded-xl border border-hairline bg-surface shadow-console",
        drag.isOver && "ring-2 ring-accent/60",
        highlighted && "ring-2 ring-accent/50",
      )}
    >
      <div
        className={cn(
          "group flex items-center gap-2.5 bg-sand/50 px-3 py-3",
          open && "border-b border-hairline/60",
        )}
      >
        <DragHandle label={mod.title} onNudge={drag.onNudge} onDragStart={drag.onDragStart} />

        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <Layers aria-hidden className="size-[1.05rem]" />
        </span>

        <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[0.95rem] font-semibold text-ink">{mod.title}</span>
          <span className="block truncate text-[0.72rem] text-ink-soft">
            {items > 0 ? pluralize(items, "item") : "Empty"}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-0.5">
          <AddContentMenu
            onAdd={handlers.onAdd}
            moduleId={Number(mod.id)}
            scope="module"
            label="Add"
          />
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => handlers.onEditModule(mod)}
              aria-label={`Rename ${mod.title}`}
            >
              <Pencil />
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              onClick={() => handlers.onDeleteModule(mod)}
              aria-label={`Delete ${mod.title}`}
            >
              <Trash2 />
            </Button>
          </span>

          {/* The one expand control on the card. */}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${mod.title}`}
            className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-raise hover:text-ink"
          >
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform", open && "rotate-180")}
            />
          </button>
        </span>
      </div>

      {open && children}
    </div>
  );
}

/* -------------------------------------------------------------- The outline */

export function CourseOutline({
  modules,
  handlers,
  openIds,
  onToggle,
}: {
  modules: CourseModule[];
  handlers: OutlineHandlers;
  openIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const dragging = useRef<DragPayload | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const start = (payload: DragPayload) => (e: React.DragEvent) => {
    dragging.current = payload;
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag with nothing on the transfer.
    e.dataTransfer.setData("text/plain", String(payload.id));
    e.stopPropagation();
  };

  /**
   * A drop target accepts only its own kind, from its own module.
   *
   * Moving content between modules needs the drop to also reparent it. The
   * endpoint supports that, but working out "which index in which module" from
   * a hover is a separate problem — and a cross-module drag that lands in the
   * wrong place is worse than one that visibly refuses.
   */
  const targetFor = (kind: MoveKind, parentId: number | null, index: number, key: string) => ({
    isOver: over === key,
    onDragOver: (e: React.DragEvent) => {
      const held = dragging.current;
      if (!held || held.kind !== kind || held.parentId !== parentId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const held = dragging.current;
      setOver(null);
      dragging.current = null;
      if (!held || held.kind !== kind || held.parentId !== parentId) return;
      handlers.onReorder(held, index);
    },
  });

  if (modules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline px-6 py-14 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent/10 text-accent">
          <GraduationCap aria-hidden className="size-6" />
        </span>
        <p className="mt-4 font-display text-lg text-ink">This course is empty</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-soft">
          Start with a module — a major section of the course — then add lessons, videos and
          quizzes inside it.
        </p>
        <div className="mt-5 flex justify-center">
          <AddContentMenu onAdd={handlers.onAdd} label="Add Content" size="md" />
        </div>
      </div>
    );
  }

  return (
    /*
     * The trailing space keeps the page tall enough that collapsing the last
     * module never forces the browser to clamp the scroll position, which is
     * what made the whole view jump.
     */
    <div className="space-y-2.5 pb-[60vh]">
      {modules.map((mod, index) => {
        const parentId = Number(mod.id);
        const quizzes = mod.quizzes ?? [];
        const empty = mod.lessons.length === 0 && quizzes.length === 0;

        return (
          <ModuleCard
            key={mod.id}
            mod={mod}
            handlers={handlers}
            open={openIds.has(parentId)}
            onToggle={() => onToggle(parentId)}
            highlighted={handlers.highlightId === `module-${mod.id}`}
            drag={{
              onNudge: (d) => handlers.onNudge({ kind: "module", id: parentId, parentId: null }, d),
              onDragStart: start({ kind: "module", id: parentId, parentId: null }),
              ...targetFor("module", null, index, `module-${mod.id}`),
            }}
          >
            <div className="p-2">
              {empty ? (
                <div className="px-3 py-5 text-center">
                  <p className="text-[0.82rem] text-ink-soft">Nothing in this module yet.</p>
                  <div className="mt-2.5 flex justify-center">
                    <AddContentMenu
                      onAdd={handlers.onAdd}
                      moduleId={parentId}
                      scope="module"
                      label="Add content here"
                      variant="secondary"
                    />
                  </div>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {mod.lessons.map((lesson, i) => {
                    const type = contentTypeOf(lesson);
                    return (
                      <ContentRow
                        key={`lesson-${lesson.id}`}
                        icon={<type.Icon aria-hidden className="size-4" />}
                        typeLabel={type.label}
                        title={lesson.title}
                        meta={[
                          lesson.durationMinutes ? `${lesson.durationMinutes} min` : null,
                          lesson.preview ? "Free preview" : null,
                          lesson.dripDays
                            ? `Unlocks after ${pluralize(lesson.dripDays, "day")}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        published={lesson.published}
                        onOpen={() => handlers.onEditLesson(parentId, lesson)}
                        onDelete={() => handlers.onDeleteLesson(lesson)}
                        highlighted={handlers.highlightId === `lesson-${lesson.id}`}
                        drag={{
                          label: lesson.title,
                          onNudge: (d) =>
                            handlers.onNudge({ kind: "lesson", id: Number(lesson.id), parentId }, d),
                          onDragStart: start({ kind: "lesson", id: Number(lesson.id), parentId }),
                          ...targetFor("lesson", parentId, i, `lesson-${lesson.id}`),
                        }}
                      />
                    );
                  })}

                  {quizzes.map((quiz, i) => (
                    <ContentRow
                      key={`quiz-${quiz.id}`}
                      icon={<HelpCircle aria-hidden className="size-4" />}
                      typeLabel={quiz.kind === "graded" ? "Test" : "Quiz"}
                      title={quiz.title}
                      meta={pluralize(quiz.questionCount, "question")}
                      published={quiz.published}
                      onOpen={() => handlers.onEditQuiz(quiz)}
                      highlighted={handlers.highlightId === `quiz-${quiz.id}`}
                      drag={{
                        label: quiz.title,
                        onNudge: (d) =>
                          handlers.onNudge({ kind: "quiz", id: Number(quiz.id), parentId }, d),
                        onDragStart: start({ kind: "quiz", id: Number(quiz.id), parentId }),
                        ...targetFor("quiz", parentId, i, `quiz-${quiz.id}`),
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>
          </ModuleCard>
        );
      })}
    </div>
  );
}

/** Open state for every module, seeded open on first load. */
export function useOutlineOpenState(modules: CourseModule[] | null) {
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [seeded, setSeeded] = useState(false);

  if (modules && !seeded) {
    setOpenIds(new Set(modules.map((m) => Number(m.id))));
    setSeeded(true);
  }

  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return { openIds, toggle };
}
