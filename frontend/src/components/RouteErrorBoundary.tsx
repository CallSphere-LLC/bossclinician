import { Component, type ReactNode } from "react";
import { useLocation } from "react-router";
import { claimRouteRecovery } from "@/lib/routeRecovery";

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) {
    try {
      if (claimRouteRecovery(error, window.location.href, window.sessionStorage)) {
        window.location.reload();
      }
    } catch { /* Keep the usable error screen if browser storage is blocked. */ }
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" className="theme-luxe flex min-h-[40vh] flex-col items-center justify-center gap-5 bg-night px-5 py-12 text-center text-white">
        <h1 className="font-display text-3xl">This page couldn’t load</h1>
        <p className="max-w-md text-orchid">Check your connection, then try again.</p>
        <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-full border border-gold px-6 py-3 text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Try again</button>
        <a href="/" className="underline underline-offset-4">Back to home</a>
      </section>
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Boundary resetKey={location.pathname + location.search}>{children}</Boundary>;
}
