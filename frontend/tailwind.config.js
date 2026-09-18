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
      // A wide but short window (a laptop browser zoomed in, or a window dragged
      // down to a strip). The width breakpoints hand it desktop gutters that then
      // fill half of a 460px-tall screen with empty band, so vertical rhythm also
      // answers to height. Declared after the width screens, so it wins.
      screens: {
        short: { raw: "(min-width: 1024px) and (max-height: 600px)" },
      },
      colors: {
        // ────────────────────────────────────────────────────────────────
        // OBSIDIAN LUXE — the dark surface scale.
        // Every public surface stacks on `night`; `night-deep` is the page
        // floor, `night-raised`/`night-veil` are the two elevations glass
        // panels sit on. Kept as its own scale so the legacy light tokens
        // below keep rendering the not-yet-migrated pages unchanged.
        // ────────────────────────────────────────────────────────────────
        night: {
          DEFAULT: "rgb(var(--c-night, 10 7 19) / <alpha-value>)",
          deep: "rgb(var(--c-night-deep, 6 4 11) / <alpha-value>)",
          raised: "rgb(var(--c-night-raised, 16 11 28) / <alpha-value>)",
          veil: "rgb(var(--c-night-veil, 23 16 38) / <alpha-value>)",
        },
        orchid: {
          DEFAULT: "rgb(var(--c-orchid, 185 162 214) / <alpha-value>)", // primary body copy on dark
          dim: "rgb(var(--c-orchid-dim, 139 121 168) / <alpha-value>)", // secondary copy
          faint: "rgb(var(--c-orchid-faint, 99 84 115) / <alpha-value>)", // tertiary / captions
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
          bright: "rgb(var(--c-plum-bright) / <alpha-value>)",
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
          DEFAULT: "rgb(var(--c-lilac) / <alpha-value>)",
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
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body: ["Montserrat", "Arial", "sans-serif"],
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
