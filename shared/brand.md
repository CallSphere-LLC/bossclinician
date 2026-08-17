# Boss Clinician — Brand Tokens (redesign)

Derived from the original Kajabi site, elevated for a richer, more dynamic look.

## Palette
| Token | Hex | Use |
|-------|-----|-----|
| `--plum` (primary) | `#72628a` | primary brand purple |
| `--plum-deep` | `#574a6e` | hover/darker purple |
| `--ink` (navy) | `#313d5a` | headings, dark sections, text |
| `--ink-soft` | `#4a5678` | secondary text on light |
| `--cream` | `#fefbf9` | page background |
| `--sand` | `#f3ede9` | alt section background |
| `--lilac` | `#cbc5ea` | soft accents, chips |
| `--lilac-tint` | `#eceaf7` | tinted cards/backgrounds |
| `--white` | `#ffffff` | cards |
| `--gold` (accent) | `#c9a86a` | premium accent / CTA highlight, dividers |

Signature gradient: `linear-gradient(135deg, #72628a 0%, #313d5a 100%)` — hero, CTA bands.
Accent gradient: `linear-gradient(120deg, #cbc5ea, #eceaf7)`.

## Typography
- **Display / headings:** an elegant serif — use **"Fraunces"** (Google Fonts) for hero + section headers (weights 400/500/600, optical). Falls back to Georgia.
- **Body / UI:** **"Inter"** (or keep "Open Sans" from original) 400/500/600.
- Generous line-height (1.6 body), tight display leading. Uppercase small-caps eyebrow labels with letter-spacing.

## Motion (Framer Motion)
- Scroll-reveal fade/slide-up on section entry (staggered children).
- Hero: subtle animated gradient + floating photo card / parallax.
- Cards: lift + shadow on hover, image zoom.
- Buttons: gradient shift + micro-scale on hover.
- Respect `prefers-reduced-motion`.

## Voice / content anchors
- Tagline energy: "Outgrowing Alma, Headway, or Talkspace? That's a sign you're ready for more."
- Pillars: **PROVEN** (B.O.S.S Blueprint), **PERSONAL** (1:1), **PREMIUM** (limited spots).
- Value props: More Freedom · More Financial Stability · More Flexibility.
- Primary CTAs: "Apply for 1:1 Coaching", "Watch the Free Masterclass", "Work With Me".
- B.O.S.S Blueprint = five-pillar framework (central IP).

## Logos / key images (in `frontend/public/images/`)
- `848a1afba946.png` — header logo (yhoward lcsw)
- `5f84052ec83a.jpg` / `5336f86...y.jpg` — Yvette Howard portrait
- `755b9b49389d.webp` — "BOSS CLINICIAN" brand mark
- Testimonial photos: `f48662c2e2cf.png`, `a9f02fa658eb.png`, `5227d6258979.png`
- See `shared/content.json` per-page `images[]` for the rest (alt text included).
