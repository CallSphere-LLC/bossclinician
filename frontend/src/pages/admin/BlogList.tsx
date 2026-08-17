import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { BlogPost } from "@/types";
import { formatDate } from "@/lib/format";
import { Badge, Button, EmptyState, ErrorNotice, PageHeader } from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { PUBLISH_LABEL, friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Whether readers can actually see this post.
 *
 * The public site gates on the `published` flag — the date is only when it first
 * went up — so a post taken down still carries a date and must not be shown here
 * as live. The shared BlogCard type predates that column, hence the narrow cast.
 */
function isLive(post: BlogPost): boolean {
  const flag = (post as BlogPost & { published?: boolean }).published;
  return flag ?? Boolean(post.publishedAt);
}

export default function BlogList() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .blogList()
      .then(setPosts)
      .catch(() => setError("We couldn't load your posts. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  const handleDelete = useCallback(
    async (post: BlogPost) => {
      const ok = await confirm({
        title: `Delete “${post.title}”?`,
        description:
          "It comes off your website straight away, and there's no way to get it back.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await adminApi.blogDelete(post.id);
        toast.success(`“${post.title}” is deleted.`);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "post"));
      }
    },
    [confirm, load],
  );

  const columns = useMemo<ColumnDef<BlogPost, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Post",
        cell: ({ row }) => (
          <Link
            to={`/admin/blog/${row.original.id}`}
            className="flex min-w-0 items-center gap-3 hover:text-plum"
          >
            {row.original.coverImage ? (
              <img
                src={row.original.coverImage}
                alt=""
                loading="lazy"
                className="size-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
                <FileText className="size-4" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.original.title}</span>
              <span className="block truncate text-xs text-ink-soft">
                About {pluralize(row.original.readMinutes, "minute")} to read
              </span>
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "author",
        header: "Written by",
        cell: ({ row }) => <span className="text-sm text-ink-soft">{row.original.author}</span>,
      },
      {
        accessorKey: "publishedAt",
        header: "On your site",
        cell: ({ row }) =>
          isLive(row.original) ? (
            <div>
              <Badge tone="green">{PUBLISH_LABEL.live}</Badge>
              {row.original.publishedAt && (
                <p className="mt-1 text-xs text-ink-soft">
                  Since {formatDate(row.original.publishedAt)}
                </p>
              )}
            </div>
          ) : (
            <Badge tone="slate">{PUBLISH_LABEL.draft}</Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button asChild variant="ghost" size="iconSm" aria-label={`Edit ${row.original.title}`}>
              <Link to={`/admin/blog/${row.original.id}`}>
                <Pencil />
              </Link>
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${row.original.title}`}
              onClick={() => handleDelete(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [handleDelete],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website"
        title="Blog Posts"
        description="Your articles. Write a new one, tidy up an old one, and choose which ones people can read."
        actions={
          <Button asChild size="sm">
            <Link to="/admin/blog/new">
              <Plus />
              Write a post
            </Link>
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={posts}
        searchPlaceholder="Search your posts…"
        itemNoun={{ one: "post", many: "posts" }}
        minWidth="720px"
        emptyState={
          <EmptyState
            icon={<FileText />}
            title="No posts yet"
            description="Write your first article — or ask for a first draft and edit it into your own words."
            action={
              <Button asChild size="sm">
                <Link to="/admin/blog/new">Write your first post</Link>
              </Button>
            }
          />
        }
      />

      {confirmDialog}
    </div>
  );
}
