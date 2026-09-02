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
