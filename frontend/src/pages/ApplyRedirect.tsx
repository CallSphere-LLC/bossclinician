import { Navigate, useLocation } from "react-router";

/**
 * /apply — the Boardroom application (sheet row 245, 21 Nov 2026: the page
 * title already named the Boardroom while the body invited every stage and
 * promised a reply within 24 hours). Client navigation counterpart to the
 * permanent redirect in nginx/site.conf; the query string (campaign tags) is
 * kept and the visitor lands on the application section.
 */
export default function ApplyRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/boardroom${search}#apply`} replace />;
}
