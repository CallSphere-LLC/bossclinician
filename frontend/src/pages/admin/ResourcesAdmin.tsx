import { CrudManager, type CrudChoice, type FieldConfig } from "@/pages/admin/CrudManager";
import { adminApi } from "@/lib/api";
import type { Resource } from "@/types";

/**
 * The four types the public Resources page knows how to colour
 * (frontend/src/pages/Resources.tsx). Offering them as a list stops a typo
 * turning a guide into an uncoloured card nobody notices.
 */
const RESOURCE_TYPES: CrudChoice[] = [
  { value: "guide", label: "Guide" },
  { value: "checklist", label: "Checklist" },
  { value: "tool", label: "Tool" },
  { value: "masterclass", label: "Masterclass" },
];

const fields: FieldConfig<Resource>[] = [
  { key: "title", label: "Name", placeholder: "The Practice Reset Planner", wide: true },
  {
    key: "description",
    label: "What they'll get",
    type: "textarea",
    placeholder: "A one-page plan for rebuilding your week around the work you actually want.",
  },
  { key: "image", label: "Cover image", type: "picture" },
  { key: "kind", label: "What type is it?", type: "choice", options: RESOURCE_TYPES },
  { key: "ctaLabel", label: "Button text", placeholder: "Download it" },
  {
    key: "ctaUrl",
    label: "Button goes to",
    hint: "a page on your site, or a full web address",
    placeholder: "/apply",
  },
  { key: "sort", label: "Order", hint: "lower numbers show first", type: "number" },
  { key: "published", label: "Live on my site", type: "checkbox" },
];

const emptyItem: Partial<Resource> = {
  title: "",
  // Filled in for her on save — see CrudManager's `autoSlug`.
  slug: "",
  description: "",
  image: "",
  ctaLabel: "Download",
  ctaUrl: "/apply",
  kind: "guide",
  sort: 0,
  published: true,
};

export default function ResourcesAdmin() {
  return (
    <CrudManager<Resource>
      title="Resources"
      description="Free guides and downloads you offer on your website."
      noun={{ one: "free resource", many: "free resources" }}
      nameHeader="Resource"
      fields={fields}
      emptyItem={emptyItem}
      autoSlug={{ key: "slug", from: "title" }}
      list={adminApi.resourcesList}
      create={adminApi.resourceCreate}
      update={adminApi.resourceUpdate}
      remove={adminApi.resourceDelete}
      renderRowTitle={(item) => item.title}
      renderRowSubtitle={(item) => item.description}
      emptyTitle="Nothing to give away yet"
      emptyDescription="Add your first free resource and it will show up on your Resources page."
    />
  );
}
