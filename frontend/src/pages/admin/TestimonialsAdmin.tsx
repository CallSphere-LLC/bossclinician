import { CrudManager, type FieldConfig } from "@/pages/admin/CrudManager";
import { adminApi } from "@/lib/api";
import type { Testimonial } from "@/types";

const fields: FieldConfig<Testimonial>[] = [
  { key: "name", label: "Their name", placeholder: "Jane Smith" },
  { key: "credential", label: "Letters after their name", hint: "optional", placeholder: "LCSW" },
  { key: "practice", label: "Their practice or business", hint: "optional" },
  {
    key: "quote",
    label: "What they said",
    type: "textarea",
    placeholder: "In three months I doubled my rates and stopped dreading Mondays.",
  },
  /*
   * One photo, two columns. The card on the public site reads `photo` while the
   * saved column is `image`, and she has no way of knowing which is which — so
   * the picker fills both and reads back whichever one already has a picture in
   * it. Nothing she saved under either name is lost.
   */
  {
    key: "photo",
    label: "Photo",
    hint: "a square headshot looks best",
    type: "picture",
    mirrorKeys: ["image"],
  },
  { key: "sort", label: "Order", hint: "lower numbers show first", type: "number" },
  { key: "published", label: "Live on my site", type: "checkbox" },
];

const emptyItem: Partial<Testimonial> = {
  name: "",
  credential: "",
  practice: "",
  quote: "",
  photo: "",
  image: "",
  sort: 0,
  published: true,
};

export default function TestimonialsAdmin() {
  return (
    <CrudManager<Testimonial>
      title="Testimonials"
      description="The kind words clients have said about working with you."
      noun={{ one: "testimonial", many: "testimonials" }}
      nameHeader="Who said it"
      fields={fields}
      emptyItem={emptyItem}
      list={adminApi.testimonialsList}
      create={adminApi.testimonialCreate}
      update={adminApi.testimonialUpdate}
      remove={adminApi.testimonialDelete}
      renderRowTitle={(item) =>
        item.credential ? `${item.name} — ${item.credential}` : item.name
      }
      renderRowSubtitle={(item) => item.practice ?? ""}
      emptyTitle="No testimonials yet"
      emptyDescription="Add the first kind word a client has sent you and it will show on your website."
    />
  );
}
