import {
  loadStripe,
  type Appearance,
  type Stripe,
  type StripePaymentElementOptions,
} from "@stripe/stripe-js";
import type { SiteTheme } from "@/lib/siteTheme";

/**
 * Stripe.js, loaded once, and the appearance that makes it look like the rest
 * of the page.
 *
 * The Payment Element is an iframe we cannot style with Tailwind, so the theme
 * has to be restated here in Stripe's own vocabulary. The values are the same
 * tokens the dark theme uses everywhere else — a card field that is nearly the
 * house style reads as a phishing form, so it either matches or it is obviously
 * Stripe's own default.
 */

const PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? "";

let stripePromise: Promise<Stripe | null> | null = null;

/** False when the key is missing, which the page reports rather than crashing. */
export function stripeConfigured(): boolean {
  return PUBLISHABLE_KEY !== "";
}

/**
 * The shared Stripe.js instance.
 *
 * `loadStripe` is memoised because each call injects the script again, and two
 * copies of Stripe.js on one page break the Payment Element's own state.
 */
export function getStripe(): Promise<Stripe | null> | null {
  if (!stripeConfigured()) return null;
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

const GOLD = "#C9A46A";
const ORCHID = "#B9A2D6";

export const luxeAppearance: Appearance = {
  theme: "night",
  labels: "above",
  variables: {
    fontFamily: "Montserrat, Arial, sans-serif",
    fontSizeBase: "15px",
    spacingUnit: "4px",
    borderRadius: "12px",
    colorPrimary: GOLD,
    // A solid value rather than the page's translucent white: the iframe has no
    // access to what is behind it, so transparency here paints black.
    colorBackground: "#100B1C",
    colorText: "#FFFFFF",
    colorTextSecondary: ORCHID,
    colorTextPlaceholder: "#635473",
    colorDanger: "#F87171",
    colorIcon: ORCHID,
  },
  rules: {
    ".Input": {
      backgroundColor: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "none",
      padding: "12px 14px",
    },
    ".Input:focus": {
      border: `1px solid rgba(201,164,106,0.6)`,
      boxShadow: "0 0 0 2px rgba(201,164,106,0.35)",
    },
    ".Input--invalid": { border: "1px solid rgba(248,113,113,0.6)" },
    ".Label": {
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: ORCHID,
    },
    ".Tab": {
      backgroundColor: "rgba(255,255,255,0.035)",
      border: "1px solid rgba(255,255,255,0.09)",
    },
    ".Tab:hover": { border: "1px solid rgba(201,164,106,0.35)" },
    ".Tab--selected": {
      backgroundColor: "rgba(201,164,106,0.10)",
      border: `1px solid rgba(201,164,106,0.55)`,
      color: "#FFFFFF",
    },
    ".Block": {
      backgroundColor: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
    },
  },
};

/**
 * The same appearance restated for the light site theme. The iframe cannot see
 * the page's CSS variables, so the light palette from site-theme.css is named
 * outright: white fields, ink text, the darker gold the light theme uses.
 * Without it a buyer in light mode types white digits into a near-black box on
 * a white page.
 */
const INK = "#1E1828";
const INK_SOFT = "#564D60";
const HAIRLINE = "#D8D3DF";
const GOLD_ON_LIGHT = "#76501B";

export const luxeLightAppearance: Appearance = {
  theme: "stripe",
  labels: "above",
  variables: {
    fontFamily: "Montserrat, Arial, sans-serif",
    fontSizeBase: "15px",
    spacingUnit: "4px",
    borderRadius: "12px",
    colorPrimary: GOLD_ON_LIGHT,
    colorBackground: "#FFFFFF",
    colorText: INK,
    colorTextSecondary: INK_SOFT,
    colorTextPlaceholder: "#8D849A",
    colorDanger: "#B42318",
    colorIcon: INK_SOFT,
  },
  rules: {
    ".Input": {
      backgroundColor: "#FFFFFF",
      border: `1px solid ${HAIRLINE}`,
      boxShadow: "none",
      padding: "12px 14px",
    },
    ".Input:focus": {
      border: "1px solid rgba(118,80,27,0.7)",
      boxShadow: "0 0 0 2px rgba(201,164,106,0.35)",
    },
    ".Input--invalid": { border: "1px solid rgba(180,35,24,0.7)" },
    ".Label": {
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: INK_SOFT,
    },
    ".Tab": {
      backgroundColor: "#FFFFFF",
      border: `1px solid ${HAIRLINE}`,
      boxShadow: "none",
    },
    ".Tab:hover": { border: "1px solid rgba(118,80,27,0.45)" },
    ".Tab--selected": {
      backgroundColor: "rgba(201,164,106,0.12)",
      border: "1px solid rgba(118,80,27,0.7)",
      color: INK,
    },
    ".Block": {
      backgroundColor: "#F5F1F9",
      border: `1px solid ${HAIRLINE}`,
    },
  },
};

/** The appearance for the active site theme (see `useSiteTheme`). */
export function appearanceForTheme(theme: SiteTheme): Appearance {
  return theme === "light" ? luxeLightAppearance : luxeAppearance;
}

/**
 * The Element's own field set.
 *
 * Name, email and phone are collected by the order form above it, so they are
 * `never` here and passed at confirmation instead — asking twice on a phone is
 * how a checkout loses people. The address is the exception: when the offer does
 * not ask for one we let Stripe collect whatever the chosen payment method
 * requires, because some methods will not confirm without it.
 */
export function paymentElementOptions(collectAddress: boolean): StripePaymentElementOptions {
  return {
    layout: { type: "tabs", defaultCollapsed: false },
    fields: {
      billingDetails: {
        name: "never",
        email: "never",
        phone: "never",
        address: collectAddress ? "never" : "auto",
      },
    },
    wallets: { applePay: "auto", googlePay: "auto" },
  };
}
