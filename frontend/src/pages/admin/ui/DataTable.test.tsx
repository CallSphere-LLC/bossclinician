import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./DataTable";

type Row = { email: string; joined: string; actions: string };

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "email", header: "Email address" },
  { accessorKey: "joined", header: "Joined your list" },
  { accessorKey: "actions", header: "Actions", enableSorting: false },
];

describe("DataTable mobile sorting", () => {
  it("offers the sortable columns and both directions when the desktop header is hidden", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={[{ email: "a@example.com", joined: "Today", actions: "" }]}
        emptyState="No subscribers"
      />,
    );

    expect(html).toContain('class="flex min-w-0 basis-full items-center gap-2 text-xs font-medium text-ink-soft sm:hidden"');
    expect(html).toContain("Sort by");
    expect(html).toContain("Email address (ascending)");
    expect(html).toContain("Email address (descending)");
    expect(html).toContain("Joined your list (ascending)");
    expect(html).not.toContain("Actions (ascending)");
  });

  it("does not add a useless sort control to an unsortable table", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={[{ accessorKey: "actions", header: "Actions", enableSorting: false }]}
        data={[{ email: "", joined: "", actions: "View" }]}
        emptyState="No items"
      />,
    );

    expect(html).not.toContain("Sort by");
  });
});
