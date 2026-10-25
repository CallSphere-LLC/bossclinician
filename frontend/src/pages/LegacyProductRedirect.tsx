import { Navigate, useLocation } from "react-router";

/** Client navigation counterpart to the permanent redirects in nginx/site.conf. */
export default function LegacyProductRedirect() {
  const { pathname, search, hash } = useLocation();
  const destination = pathname.endsWith("/directory-makeover-audit")
    ? "/services/directory-makeover-audit"
    : "/downloads/rate-negotiation-letter-template";
  return <Navigate to={destination + search + hash} replace />;
}
