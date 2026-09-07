import { useMemo, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Search,
} from "lucide-react";
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
  /**
   * Turn on the §49 selection column. `bulkActions` is rendered in a bar that
   * replaces the toolbar while anything is selected, and is handed the selected
   * rows plus a callback that clears the selection once the action is done.
   */
  bulkActions?: (selected: TData[], clear: () => void) => ReactNode;
  /** Show the §49 column-visibility control. */
  columnControls?: boolean;
  /**
   * Keeps the header visible while a long list scrolls (§49). Off by default
   * because a sticky header inside a short table just adds a seam.
   */
  stickyHeader?: boolean;
}

/**
 * A checkbox that can also be half-ticked.
 *
 * `indeterminate` is a DOM property, not an attribute, so React cannot set it
 * from JSX — hence the ref callback. Without it "some rows on this page are
 * selected" renders identically to "none are".
 */
function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="size-4 cursor-pointer accent-[rgb(var(--c-accent-solid))]"
    />
  );
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
  bulkActions,
  columnControls = false,
  stickyHeader = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // The selection column is prepended here rather than asked of every caller,
  // so turning selection on is one prop and not a column definition copied
  // across a dozen list screens.
  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!bulkActions) return columns;
    const selectColumn: ColumnDef<TData, unknown> = {
      id: "__select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table: t }) => (
        <SelectCheckbox
          checked={t.getIsAllPageRowsSelected()}
          indeterminate={t.getIsSomePageRowsSelected()}
          onChange={(next) => t.toggleAllPageRowsSelected(next)}
          label="Select every row on this page"
        />
      ),
      cell: ({ row }) => (
        <SelectCheckbox
          checked={row.getIsSelected()}
          onChange={(next) => row.toggleSelected(next)}
          label="Select this row"
        />
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, bulkActions]);

  const table = useReactTable({
    data: data ?? [],
    columns: allColumns,
    state: { sorting, globalFilter, rowSelection, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: Boolean(bulkActions),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const clearSelection = () => setRowSelection({});

  const loading = data === null;
  const rows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const showPagination = !loading && totalRows > pageSize;
  const firstRowOnPage = pageIndex * pageSize + 1;
  const lastRowOnPage = Math.min(firstRowOnPage + rows.length - 1, totalRows);

  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-console">
      {/* §49's bulk-action bar. It replaces the toolbar rather than stacking
          above it: while rows are selected, the only thing worth offering is
          what can be done to them. */}
      {bulkActions && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline/60 bg-accent-soft px-4 py-3">
          <p className="text-sm font-semibold text-accent">
            {pluralize(selectedRows.length, itemNoun.one, itemNoun.many)} selected
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions(selectedRows, clearSelection)}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            Clear selection
          </Button>
        </div>
      )}

      {(searchPlaceholder || toolbar || columnControls) &&
        !(bulkActions && selectedRows.length > 0) && (
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
                className="h-11 w-full rounded-xl border border-hairline bg-raise pl-10 pr-3 text-sm text-ink outline-none transition-all placeholder:text-ink-soft/60 focus-visible:border-accent focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-accent/20"
              />
            </div>
          )}
          {toolbar}
          {!loading && (
            <span className="ml-auto shrink-0 text-xs font-medium text-ink-soft">
              {pluralize(totalRows, itemNoun.one, itemNoun.many)}
            </span>
          )}
          {columnControls && <ColumnControls table={table} />}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead
            className={cn(
              "bg-sand",
              // `sticky` needs an opaque fill: a translucent header lets the
              // rows scroll visibly through the column names.
              stickyHeader && "sticky top-0 z-10",
            )}
          >
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
                          className="group inline-flex items-center gap-1.5 rounded transition-colors hover:text-accent"
                        >
                          {content}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5 text-accent" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5 text-accent" />
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
                  {allColumns.map((_col, ci) => (
                    <td key={ci} className="px-5 py-4">
                      <Skeleton className={cn("h-4", ci === 0 ? "w-3/5" : "w-20")} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} className="p-0">
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
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(
                    "group transition-colors hover:bg-raise",
                    row.getIsSelected() && "bg-accent-soft",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-5 py-3.5 align-middle text-ink">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
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

/**
 * §49's column controls.
 *
 * Only columns that declare a string header appear — an icon-only actions
 * column has no name to offer, and "hide the column with the buttons in it" is
 * not a setting anyone wants. The last visible column cannot be hidden, since
 * an empty table is not a view of anything.
 */
function ColumnControls<TData>({
  table,
}: {
  table: ReturnType<typeof useReactTable<TData>>;
}) {
  const hideable = table
    .getAllLeafColumns()
    .filter((col) => col.getCanHide() && typeof col.columnDef.header === "string");

  if (hideable.length === 0) return null;
  const visibleCount = hideable.filter((c) => c.getIsVisible()).length;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label="Choose which columns to show">
          <Columns3 />
          Columns
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[12rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
            Show columns
          </DropdownMenu.Label>
          {hideable.map((column) => {
            const visible = column.getIsVisible();
            const last = visible && visibleCount === 1;
            return (
              <DropdownMenu.Item
                key={column.id}
                disabled={last}
                // Radix closes on select; keeping it open lets her tick several
                // without reopening the menu each time.
                onSelect={(event) => {
                  event.preventDefault();
                  if (!last) column.toggleVisibility(!visible);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-raise",
                  last ? "cursor-not-allowed text-ink-soft" : "text-ink",
                )}
              >
                <span className="grid size-4 shrink-0 place-items-center">
                  {visible && <Check aria-hidden className="size-3.5 text-accent" />}
                </span>
                {String(column.columnDef.header)}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Right-aligned action cluster used in the trailing column of most tables. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>;
}
