# Boss Clinician — Frontend

Public marketing site + `/admin` CMS UI for Boss Clinician (Yvette Howard, LCSW), built with
Vite + React 18 + TypeScript (strict) + Tailwind CSS + Framer Motion + React Router.

## Stack

- **Vite** + **React 18** + **TypeScript** (strict mode)
- **Tailwind CSS** for styling, with brand tokens in `tailwind.config.js`
- **Framer Motion** (`motion/react`) for scroll reveals, parallax, and micro-interactions
- **React Router v6** for client-side routing (public site + `/admin/*`)
- **react-markdown** + `remark-gfm` for rendering blog post Markdown

## Getting started

```bash
npm install
cp .env.example .env   # optional — defaults to /api
npm run dev
```

The dev server runs at `http://localhost:5173`. The site renders fully with bundled fallback
content even with **no backend running** — every collection (`courses`, `resources`,
`testimonials`, `blog`) fetches from `VITE_API_BASE` and falls back to static data in
`src/content/` on any failure.

## Build

```bash
npm run build     # type-checks (tsc -b) then builds to dist/
npm run preview   # preview the production build locally
```

## Environment variables

| Variable          | Default | Description                                   |
|--------------------|---------|------------------------------------------------|
| `VITE_API_BASE`    | `/api`  | Base URL the frontend calls for all API routes. |

## Project structure

```
src/
  main.tsx, App.tsx        # entry + routing
  index.css                 # Tailwind layers + global styles
  lib/
    api.ts                  # typed fetch client (public + admin)
    cn.ts                   # className helper (clsx + tailwind-merge)
  hooks/
    useAuth.tsx              # admin auth context (JWT in localStorage)
    useCollection.ts          # fetch-with-bundled-fallback hook
  types.ts                  # shared TS types matching the gateway contract
  content/                  # bundled fallback data derived from shared/content.json
    site.ts, blog.ts, courses.ts, resources.ts, testimonials.ts
  components/
    layout/                 # Header, Footer, Layout
    ui/                      # Button, Container, SectionHeading, Reveal, Chip
    home/                    # Home page sections (Hero, Pillars, Steps, …)
    forms/                   # LeadForm, SubscribeForm
    ChatWidget.tsx           # floating AI chat widget (all public pages)
  pages/                    # route components (Home, About, WorkWithMe, Courses, …)
    legal/                   # Privacy, Terms, Disclaimer, Financial Disclaimer
    admin/                    # /admin/* CMS (login, dashboard, CRUD, leads, settings)
```

## Admin CMS

Visit `/admin/login`. On success, a JWT is stored in `localStorage` and sent as
`Authorization: Bearer <token>` on every `/admin/*` request. Sections:

- **Dashboard** — stats from `/api/admin/stats`
- **Blog Posts** — list/create/edit/delete, Markdown editor with live preview, an
  **AI Blog Generator** button (`POST /api/admin/ai/generate-blog`), and image upload for
  the cover image (`POST /api/admin/media`)
- **Courses / Testimonials / Resources** — generic CRUD tables (`CrudManager.tsx`)
- **Leads Inbox** — view + update lead status
- **Subscribers** — read-only list
- **Settings** — raw JSON editor for nav/footer/contact settings

## Docker

```bash
docker build -t bossclinician-frontend --build-arg VITE_API_BASE=/api .
docker run -p 8080:80 bossclinician-frontend
```

The multi-stage `Dockerfile` builds the app with Node 20, then serves the static `dist/`
output with `nginx:1.27-alpine` using `nginx.conf`, which includes a SPA fallback
(`try_files $uri $uri/ /index.html`) so client-side routes like `/blog/:slug` and
`/admin/*` work on refresh.

## Notes / deviations

- Images referenced from `public/images/` (already populated from the scrape) — no external
  image URLs anywhere.
- `pages` CRUD (`GET/PUT /api/admin/pages/:slug`) is defined in the API client for future use,
  but the Home/About/Work With Me marketing copy currently ships as bundled content in
  `src/content/site.ts` rather than being wired to a pages editor in the admin UI — this kept
  scope focused on the explicitly required CRUD screens (Blog, Courses, Testimonials,
  Resources) plus Leads/Subscribers/Settings.
- `prefers-reduced-motion` is respected: the global stylesheet clamps animation/transition
  durations, and interactive components (`TestimonialsCarousel`, `ChatWidget`) explicitly
  check `useReducedMotion()` before autoplaying or springing.
