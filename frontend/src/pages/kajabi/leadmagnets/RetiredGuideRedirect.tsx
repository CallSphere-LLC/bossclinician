import { Navigate, useLocation } from "react-router";

/**
 * The Business Plan Guide's old addresses (removed 30 Oct 2026: the owner covers
 * it in the courses). Client navigation counterpart to the permanent redirects in
 * nginx/site.conf, as with LegacyProductRedirect.
 */
export default function RetiredGuideRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/resources${search}${hash}`} replace />;
}
