import { Navigate, useLocation } from "react-router";

/**
 * The old Forms screen, retired.
 *
 * There is one Forms page now — the builder at /admin/marketing/forms-v2, which
 * edits the same `forms` table this screen did and does everything it did
 * (questions, sharing link, preview, replies, views and conversion, adding
 * people to enquiries). Any bookmark or link to the old address lands there,
 * query and hash included, so `?form=<id>` style links keep working.
 */
export default function Forms() {
  const location = useLocation();
  return <Navigate to={`/admin/marketing/forms-v2${location.search}${location.hash}`} replace />;
}
