import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { pluralize } from "@/pages/admin/ui/friendly";
import { Button, Skeleton } from "@/pages/admin/ui/primitives";

/**
 * Shared admin table built on TanStack Table v8 (headless) so every list page
 * gets sorting, global search and pagination for free instead of re-hand-rolling
 * `<table>` markup per page.
 *
 * Pass `data={null}` to render the loading skeleton — distinct from `[]`, which
 * renders the empty state.
 */

/**
 * One shared empty array for the loading state.
 *
 * `data ?? []` inline hands TanStack a NEW array on every render while the list
 * is still loading. Its `getCoreRowModel` memo is keyed on the data identity, so
 * a fresh array fires `autoResetPageIndex`, which queues a pagination reset on a
 * microtask, which re-renders, which mints another array — a microtask loop that
 * never yields. The renderer locks up, so the fetch that would have ended the
 * loading state never resolves and the page simply never paints: no error, no
 * warning. It needs a second render while the data is still null to arm itself,
 * which is why only some tables ever showed it (the Coaching page's Sessions
 * tab clears its file list on mount, and that was enough).
 */
const NO_ROWS: never[] = [];

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[] | null;
  /** Omit to hide the search box. Name what's being searched: "Search your posts…". */
  searchPlaceholder?: string;
  /**
   * Shown when the list is genuinely empty. Always say what will fill it and
   * how — "No enquiries yet — they'll appear here as they come in." — never
   * just "No records".
   */
  emptyState: ReactNode;
  /**
   * What one row is, in her words: `{ one: "enquiry", many: "enquiries" }`.
   * Drives the count above the table, which would otherwise call her people,
   * posts and payments all "records".
   */
  itemNoun?: { one: string; many: string };
  toolbar?: ReactNode;
  initialPageSize?: number;
  /** Minimum table width before horizontal scrolling kicks in. */
  minWidth?: string;
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder,
  emptyState,
  itemNoun = { one: "item", many: "items" },
  toolbar,
  initialPageSize = 10,
  minWidth = "640px",
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data: data ?? NO_ROWS,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  const loading = data === null;
  const rows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const showPagination = !loading && totalRows > pageSize;
  const firstRowOnPage = pageIndex * pageSize + 1;
  const lastRowOnPage = Math.min(firstRowOnPage + rows.length - 1, totalRows);

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.8)]">
      {(searchPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/60 px-4 py-3.5">
          {searchPlaceholder && (
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft/60"
                aria-hidden="true"
              />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-11 w-full rounded-xl border border-hairline bg-white/[0.04] pl-10 pr-3 text-sm text-ink outline-none transition-all placeholder:text-ink-soft/55 focus-visible:border-gold/60 focus-visible:bg-white/[0.07] focus-visible:ring-4 focus-visible:ring-gold/15"
              />
            </div>
          )}
          {toolbar}
          {!loading && (
            <span className="ml-auto shrink-0 text-xs font-medium text-ink-soft">
              {pluralize(totalRows, itemNoun.one, itemNoun.many)}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="admin-data-table w-full text-left text-sm" style={{ minWidth }}>
          <colgroup>
            {table.getVisibleLeafColumns().map((column, index, all) => (
              <col key={column.id} style={column.id === "actions" ? { width: "180px" } : index === 0 && all.length > 2 ? { width: all.length > 5 ? "26%" : "40%" } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-sand">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                      className="whitespace-nowrap px-5 py-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="group inline-flex items-center gap-1.5 rounded transition-colors hover:text-plum"
                        >
                          {content}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5 text-plum" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5 text-plum" />
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-hairline/60">
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i}>
                  {columns.map((_col, ci) => (
                    <td key={ci} className="h-11 px-5 py-2">
                      <Skeleton className={cn("h-4", ci === 0 ? "w-3/5" : "w-20")} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {globalFilter ? (
                    <p className="px-5 py-12 text-center text-sm text-ink-soft">
                      Nothing here matches “{globalFilter}” — try a shorter word or clear the
                      search.
                    </p>
                  ) : (
                    emptyState
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="group h-11 transition-colors hover:bg-surface-raised">
                  {row.getVisibleCells().map((cell) => {
                    // On a phone the row is a card and the header is gone, so
                    // each value carries its own column name (admin-theme.css).
                    const header = cell.column.columnDef.header;
                    return (
                      <td
                        key={cell.id}
                        data-label={typeof header === "string" ? header : undefined}
                        className="px-5 py-2 align-middle text-ink"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div className="flex items-center justify-between gap-3 border-t border-hairline/60 px-4 py-3">
          <p className="text-xs text-ink-soft">
            {/* Counting the rows she can see beats "Page 2 of 7", which says
                nothing about how much of her list is left. */}
            Showing {firstRowOnPage}–{lastRowOnPage} of{" "}
            {pluralize(totalRows, itemNoun.one, itemNoun.many)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="iconSm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Show the previous page"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="iconSm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Show the next page"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Right-aligned action cluster used in the trailing column of most tables. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>;
}
