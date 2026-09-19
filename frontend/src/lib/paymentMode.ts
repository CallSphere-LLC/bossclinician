/** Public build configuration only; no Stripe SDK or network work on course pages. */
export const STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? "";
export const stripeTestMode = (): boolean => STRIPE_PUBLISHABLE_KEY.startsWith("pk_test_");
