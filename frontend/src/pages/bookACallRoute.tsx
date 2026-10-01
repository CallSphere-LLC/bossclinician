import { lazyRoute } from "@/ssr/lazyRoute";

/**
 * Routes for Book A Call (pages/BookACall.tsx), for App.tsx's PUBLIC_ROUTES.
 *
 * One lazy component behind all three paths, the way the podcast pages share
 * one: moving from the chooser to a call, or from a booking to its manage page,
 * keeps the chunk and does not remount the shell. Each entry carries both the
 * `Component` that PUBLIC_ROUTES and the SSR preload map (ssr/preload.ts) read
 * and a ready `element` for a plain <Route element>.
 *
 *   /book-a-call                 every listed call, the free alignment call first
 *   /book-a-call/manage/:token   a guest's own booking — the link in their email
 *   /book-a-call/:slug           one call type (also answers to its old TidyCal slug)
 */
const BookACallPage = lazyRoute(() => import("@/pages/BookACall"));

export const bookACallRoutes = [
  { path: "/book-a-call", Component: BookACallPage, element: <BookACallPage /> },
  { path: "/book-a-call/manage/:token", Component: BookACallPage, element: <BookACallPage /> },
  { path: "/book-a-call/:slug", Component: BookACallPage, element: <BookACallPage /> },
];
