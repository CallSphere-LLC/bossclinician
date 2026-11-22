import { Navigate, useLocation } from "react-router";
import { retiredPageTarget } from "./retiredPages";

/** Sends an in-app visit to a retired address on to its replacement (see ./retiredPages). */
export default function RetiredPageRedirect() {
  const { pathname, search, hash } = useLocation();
  const to = retiredPageTarget(pathname) ?? "/";
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
