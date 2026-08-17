import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";

interface BuyButtonProps {
  slug: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Creates a Stripe Checkout Session server-side, then hands the browser off to
 * Stripe's hosted checkout page. The amount is never sent from here — the API
 * reads it from the course row.
 */
export function BuyButton({ slug, label = "Enroll Now", size = "sm", className }: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.createCheckoutSession(slug);
      if (!url) throw new Error("Checkout is unavailable right now.");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout is unavailable right now.");
      setLoading(false);
    }
  }

  return (
    <span className={className}>
      <Button
        variant="gold"
        size={size}
        onClick={startCheckout}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? "Redirecting…" : label}
      </Button>
      {error && (
        <span role="alert" className="mt-2 block text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
