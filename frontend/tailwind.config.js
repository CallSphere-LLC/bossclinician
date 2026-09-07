import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
    },
    extend: {
      colors: {
        // ────────────────────────────────────────────────────────────────
        // OBSIDIAN LUXE — the dark surface scale.
        // Every public surface stacks on `night`; `night-deep` is the page
        // floor, `night-raised`/`night-veil` are the two elevations glass
        // panels sit on. Kept as its own scale so the legacy light tokens
        // below keep rendering the not-yet-migrated pages unchanged.
        // ────────────────────────────────────────────────────────────────
        night: {
          DEFAULT: "#0A0713",
          deep: "#06040B",
          raised: "#100B1C",
          veil: "#171026",
        },
        orchid: {
          DEFAULT: "#B9A2D6", // primary body copy on dark
          dim: "#8B79A8", // secondary copy
          faint: "#635473", // tertiary / captions
        },
        glow: {
          plum: "#7B5EA7",
          violet: "#4B2E83",
          gold: "#C9A46A",
        },

        // ── Themeable brand tokens ────────────────────────────────────
        // These carry *semantics* (page surface, body copy, hairline), not a
        // fixed colour, so they are resolved from CSS variables and swapped
        // wholesale per theme in index.css: `:root` is the original light
        // palette, `.theme-luxe` the public dark one, `.theme-console` the
        // admin one. That is what lets ~500 existing `text-ink` /
        // `border-hairline` / `bg-cream` usages across 45 files re-theme
        // without being touched.
        //
        // The `<alpha-value>` placeholder keeps opacity modifiers working, so
        // `text-ink/60` still resolves correctly.
        plum: {
          DEFAULT: "rgb(var(--c-plum) / <alpha-value>)",
          deep: "rgb(var(--c-plum-deep) / <alpha-value>)",
          bright: "#7B5EA7",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          soft: "rgb(var(--c-ink-soft) / <alpha-value>)",
        },
        dark: "rgb(var(--c-dark) / <alpha-value>)",
        cream: "rgb(var(--c-cream) / <alpha-value>)",
        sand: "rgb(var(--c-sand) / <alpha-value>)",
        /** Panel/card fill. Replaces bare `bg-white`, which cannot be themed. */
        surface: {
          DEFAULT: "rgb(var(--c-surface) / <alpha-value>)",
          raised: "rgb(var(--c-surface-raised) / <alpha-value>)",
        },
        lilac: {
          DEFAULT: "#A78BC4",
          soft: "rgb(var(--c-lilac-soft) / <alpha-value>)",
          tint: "rgb(var(--c-lilac-tint) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "#C9A46A",
          bright: "#E8CE9A",
          light: "#241B10", // dark gold wash (was a cream tint)
          muted: "#A07840",
          deep: "#8C6B34",
        },
        green: {
          DEFAULT: "#4A7C6B",
          bright: "#6BA891",
          light: "#12211B", // dark green wash (was a mint tint)
        },
        hairline: "rgb(var(--c-hairline) / <alpha-value>)",

        // ── Admin console tokens (Part II §7–§9, §13) ──────────────────
        // The console runs in three states — light, dark, and whatever the
        // machine says — so every colour it uses has to be a variable, not a
        // literal. `accent` is the one restrained brand accent §9 asks for;
        // `accent-solid` is the fill behind `accent-on` text, kept separate
        // because a hue readable as *text* on near-black is far too light to
        // be a button, and a hue dark enough to be a button is unreadable as
        // a link. One token cannot be both.
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          solid: "rgb(var(--c-accent-solid) / <alpha-value>)",
          on: "rgb(var(--c-accent-on) / <alpha-value>)",
          soft: "rgb(var(--c-accent-soft) / <alpha-value>)",
        },
        // The sidebar is a deeper neutral in light mode and a *lighter*
        // charcoal in dark mode (§7, §8) — it inverts its relationship to the
        // page, so it cannot reuse the surface scale.
        rail: {
          DEFAULT: "rgb(var(--c-rail) / <alpha-value>)",
          raised: "rgb(var(--c-rail-raised) / <alpha-value>)",
          text: "rgb(var(--c-rail-text) / <alpha-value>)",
          dim: "rgb(var(--c-rail-dim) / <alpha-value>)",
          line: "rgb(var(--c-rail-line) / <alpha-value>)",
        },
        // The subtle elevate fill that replaces hard-coded `white/[0.04]`.
        // Pre-composed rather than `rgb(var(…) / <alpha-value>)` because the
        // *alpha* is the part that differs between themes — near-white at 4.5%
        // over charcoal, near-black at 3.5% over ivory — and Tailwind cannot
        // take `<alpha-value>` from a variable.
        raise: {
          DEFAULT: "var(--fill-raise)",
          strong: "var(--fill-raise-strong)",
        },
        // Status meaning, per §13: muted green / restrained red / muted amber
        // / slate. Deliberately not Tailwind's stock green-500 family, which
        // is far too saturated for the "calm, executive" bar §2 sets.
        pos: {
          DEFAULT: "rgb(var(--c-pos) / <alpha-value>)",
          soft: "rgb(var(--c-pos-soft) / <alpha-value>)",
        },
        neg: {
          DEFAULT: "rgb(var(--c-neg) / <alpha-value>)",
          soft: "rgb(var(--c-neg-soft) / <alpha-value>)",
        },
        warn: {
          DEFAULT: "rgb(var(--c-warn) / <alpha-value>)",
          soft: "rgb(var(--c-warn-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body: ["Montserrat", "Arial", "sans-serif"],
        // Figures. Part II §46 names Inter first, and a dashboard's numbers
        // are the one thing on it that must be scanned rather than read:
        // Playfair's figures are lovely in a headline and wrong in a column of
        // money, where the eye needs even width and a flat baseline. Applied
        // with `tabular-nums` so a changing value does not shift its neighbours.
        numeric: ["Inter", "Montserrat", "Arial", "sans-serif"],
      },
      backgroundImage: {
        // Lifted from plum->navy: the original bottomed out at #0F1E3A, which
        // is indistinguishable from the dark surfaces it now sits on.
        "brand-gradient": "linear-gradient(135deg, #8A6BBF 0%, #4B2E83 100%)",
        "brand-gradient-soft": "linear-gradient(120deg, #EDE6F4, #F7F0E6)",
        // Gold foil used for display accents and primary buttons.
        "gold-foil":
          "linear-gradient(100deg, #A07840 0%, #C9A46A 22%, #F0DCB4 48%, #C9A46A 74%, #9A7238 100%)",
        // 1px gradient rules that fade out at both ends.
        "rule-gold":
          "linear-gradient(90deg, transparent, rgba(201,164,106,0.85) 22%, rgba(232,206,154,1) 50%, rgba(201,164,106,0.85) 78%, transparent)",
        "rule-faint":
          "linear-gradient(90deg, transparent, rgba(255,255,255,0.14) 50%, transparent)",
      },
      boxShadow: {
        soft: "0 8px 30px -8px rgba(15, 30, 58, 0.25)",
        card: "0 4px 20px -4px rgba(15, 30, 58, 0.12)",
        // Console elevations. §13 and §47 both ask for "very soft" — a shadow
        // tuned for a near-black page reads as a smudge on warm ivory and one
        // tuned for ivory disappears entirely on charcoal, so the whole value
        // is swapped per theme rather than the opacity alone.
        console: "var(--shadow-console)",
        "console-pop": "var(--shadow-console-pop)",
        // Glass panel: deep ambient drop + a 1px inner top highlight so the
        // edge catches light the way real glass does.
        glass:
          "0 24px 60px -24px rgba(0,0,0,0.85), 0 2px 10px -4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)",
        "glass-lg":
          "0 40px 90px -32px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.09)",
        "glow-gold": "0 0 0 1px rgba(201,164,106,0.35), 0 18px 50px -18px rgba(201,164,106,0.4)",
        "glow-plum": "0 0 0 1px rgba(123,94,167,0.4), 0 18px 55px -18px rgba(123,94,167,0.55)",
        "glow-green": "0 0 0 1px rgba(107,168,145,0.35), 0 18px 50px -18px rgba(107,168,145,0.4)",
      },
      keyframes: {
        gradientShift: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        // Aurora orbs drift on long, offset cycles so the background never
        // visibly loops.
        auroraA: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(6%, -8%, 0) scale(1.12)" },
          "66%": { transform: "translate3d(-5%, 6%, 0) scale(0.94)" },
        },
        auroraB: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1.05)" },
          "40%": { transform: "translate3d(-8%, 5%, 0) scale(0.92)" },
          "75%": { transform: "translate3d(5%, 8%, 0) scale(1.14)" },
        },
        sheen: {
          "0%": { transform: "translateX(-140%) skewX(-18deg)" },
          "100%": { transform: "translateX(240%) skewX(-18deg)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "0.85" },
        },
        scrollCue: {
          "0%": { transform: "translateY(-60%)", opacity: "0" },
          "35%": { opacity: "1" },
          "100%": { transform: "translateY(160%)", opacity: "0" },
        },
      },
      animation: {
        gradient: "gradientShift 12s ease infinite",
        float: "float 6s ease-in-out infinite",
        "aurora-a": "auroraA 26s ease-in-out infinite",
        "aurora-b": "auroraB 34s ease-in-out infinite",
        sheen: "sheen 5.5s ease-in-out infinite",
        marquee: "marquee 38s linear infinite",
        "pulse-glow": "pulseGlow 5s ease-in-out infinite",
        "scroll-cue": "scrollCue 2.2s ease-in-out infinite",
      },
      maxWidth: {
        "8xl": "90rem",
      },
      transitionTimingFunction: {
        luxe: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [typography],
};
