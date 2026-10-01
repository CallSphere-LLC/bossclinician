# Boss Clinician admin theme

The admin console is dark-first and uses one brand accent: gold. Public marketing pages keep
their own `theme-luxe` treatment; these rules apply only inside `.theme-console`.
The executable token source is `frontend/src/admin-theme.css`.

| Token | Value | Use |
|---|---:|---|
| `--bg-base` | `#08070A` | Page ground |
| `--bg-surface` | `#101014` | Cards and panels |
| `--bg-surface-2` | `#16161B` | Nested panels and table heads |
| `--bg-elevated` | `#1D1D23` | Dialogs and popovers |
| `--border-subtle` | `#23232B` | Row dividers |
| `--border-strong` | `#33333D` | Inputs and elevated edges |
| `--text-primary` | `#F2EFE9` | Main text |
| `--text-secondary` | `#A8A49C` | Supporting text |
| `--text-muted` | `#6F6B64` | Captions and eyebrows |
| `--accent` | `#D4AF6E` | Primary action, active state, link, focus |
| `--accent-hover` | `#E4C486` | Accent hover only |
| `--accent-ink` | `#0B0A08` | Text on gold |
| `--success` | `#6FBF8B` | Success state |
| `--warning` | `#E0A94B` | Warning state |
| `--danger` | `#E06C6C` | Destructive/error state |
| `--info` | `#7FA8D9` | Informational state |

## One-accent rule

Gold is the only brand/accent colour in the admin. Do not introduce purple, violet, coloured
surface glows, or a second decorative accent. Status colours communicate meaning only and use a
light tint for their background. Elevation comes from a neutral surface, a one-pixel edge, and a
black shadow. Keep interactive transitions at 150 ms or less and preserve the global
`prefers-reduced-motion` override.

## Public site body-copy tokens (`theme-luxe`)

Dark values live in `.theme-luxe` in `frontend/src/index.css`; light values in
`frontend/src/site-theme.css`. Body copy must clear WCAG AA (4.5:1); the main tokens sit at
roughly 9-14:1. Running text is never lighter than weight 400, and small paragraph copy
(`p`/`li` with `text-sm`) renders at 15px — see "Readability floor" at the end of `index.css`.

| Token | Dark (on `#06040B`) | Light (on `#FFFFFF`) | Use |
|---|---|---|---|
| `--c-orchid` | `222 210 238` (14.1:1) | `48 40 60` (14.1:1) | Primary body copy |
| `--c-orchid-dim` / `--c-ink-soft` | `196 182 218` (10.7:1) | `62 54 74` (11.5:1) | Secondary copy, `.copy-luxe` |
| `--c-orchid-faint` | `160 145 184` (7.0:1) | `78 69 90` (9.0:1) | Tertiary copy, captions |
| `--c-lilac` | `190 168 216` (9.5:1) | `84 62 110` (9.2:1) | Card subtitles, accents |

Prices, stats and counts use the body font, bold, `tabular-nums` — never the display serif.
