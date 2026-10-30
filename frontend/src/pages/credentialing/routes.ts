import { lazyRoute, type RouteComponent } from "@/ssr/lazyRoute";

/**
 * Credential For You (sheet row 214). Spread into `PUBLIC_ROUTES` in App.tsx.
 * All four are server-rendered: each name is also in backend render.ts ROUTES and
 * in the no-children regex of nginx/site.conf, and the three lists move together.
 */
export const credentialingPublicRoutes: readonly { path: string; Component: RouteComponent }[] = [
  { path: "/credential-for-you", Component: lazyRoute(() => import("./CredentialForYou")) },
  { path: "/credentialing-next-steps", Component: lazyRoute(() => import("./CredentialingNextSteps")) },
  { path: "/credentialing-request", Component: lazyRoute(() => import("./CredentialingRequest")) },
  { path: "/credentialing-intake", Component: lazyRoute(() => import("./CredentialingIntake")) },
];
