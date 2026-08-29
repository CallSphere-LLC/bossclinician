import bcrypt from "bcrypt";
import crypto from "crypto";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { loadContent, ContentText } from "./contentLoader";
import {
  extractBlogPost,
  extractCoursesFromAllCourses,
  extractCoursesFromStore,
  extractResources,
  extractTestimonials,
} from "./extract";

async function ensureAdminUser(): Promise<void> {
  const email = env.adminEmail;
  const existing = await pool.query("SELECT id FROM admin_users WHERE email = $1", [email]);
  if (existing.rows.length > 0) return;

  const password = env.adminPassword || crypto.randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(password, 12);

  /**
   * The first account on an empty database is the owner, spelled out here
   * rather than inherited.
   *
   * Migration 016 promotes "the existing single admin" to `owner`, which is the
   * right thing on the live database and does nothing at all on a fresh one:
   * `applySchema()` runs before `runSeedIfEmpty()` (server.ts), so the UPDATE
   * has already swept an empty table by the time this row is written. Seeding
   * `admin` therefore produced a Yvette who — on any rebuilt or wiped database
   * — held no `admins.manage` and was refused by every `requireOwner` route,
   * i.e. could not add or remove the people on her own team.
   *
   * Anything other than an empty table is somebody else's install with its own
   * owner already in it, so a newly seeded address there gets the manager role
   * instead of a second unconditional account.
   */
  const existingAdmins = await pool.query<{ count: string }>(
    "SELECT count(*) AS count FROM admin_users"
  );
  const role = Number(existingAdmins.rows[0]?.count ?? 0) === 0 ? "owner" : "admin";

  await pool.query(
    `INSERT INTO admin_users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING`,
    [email, hash, "Yvette Howard", role]
  );

  if (!env.adminPassword) {
    // eslint-disable-next-line no-console
    console.log(
      `\n[seed] No ADMIN_PASSWORD set — generated a one-time admin password.\n` +
        `[seed]   email:    ${email}\n` +
        `[seed]   password: ${password}\n` +
        `[seed] Set ADMIN_EMAIL/ADMIN_PASSWORD in .env to control this on future boots.\n`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(`[seed] Created admin user ${email}`);
  }
}

async function isAlreadySeeded(): Promise<boolean> {
  const res = await pool.query("SELECT value FROM settings WHERE key = 'seed_completed'");
  return res.rows.length > 0 && res.rows[0].value === true;
}

async function markSeeded(): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('seed_completed', 'true')
     ON CONFLICT (key) DO UPDATE SET value = 'true'`
  );
}

function firstTextMatching(texts: ContentText[], tag: string, after = 0): string {
  for (let i = after; i < texts.length; i++) {
    if (texts[i].tag === tag) return texts[i].text.trim();
  }
  return "";
}

async function seedBlogPosts(content: ReturnType<typeof loadContent>): Promise<number> {
  let count = 0;
  for (const [key, page] of Object.entries(content)) {
    if (!key.startsWith("blog_")) continue;
    const post = extractBlogPost(key, page);
    await pool.query(
      `INSERT INTO blog_posts (slug, title, excerpt, body_md, cover_image, tags, author, read_minutes, published, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (slug) DO NOTHING`,
      [post.slug, post.title, post.excerpt, post.bodyMd, post.coverImage, post.tags, post.author, post.readMinutes, post.published]
    );
    count++;
  }
  return count;
}

async function seedTestimonials(content: ReturnType<typeof loadContent>): Promise<number> {
  const home = content["home"];
  if (!home) return 0;
  const testimonials = extractTestimonials(home);
  for (const t of testimonials) {
    await pool.query(
      `INSERT INTO testimonials (name, credential, quote, image, sort, published)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [t.name, t.credential, t.quote, t.image, t.sort]
    );
  }
  return testimonials.length;
}

async function seedCourses(content: ReturnType<typeof loadContent>): Promise<number> {
  const allCourses = content["all-courses"];
  const store = content["store"];
  const courses = [
    ...(allCourses ? extractCoursesFromAllCourses(allCourses) : []),
    ...(store ? extractCoursesFromStore(store) : []),
  ];
  let sort = 0;
  for (const c of courses) {
    await pool.query(
      `INSERT INTO courses (slug, title, subtitle, description, price_text, image, url, features, sort, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       ON CONFLICT (slug) DO NOTHING`,
      [c.slug, c.title, c.subtitle, c.description, c.priceText, c.image, c.url, JSON.stringify(c.features), sort++]
    );
  }
  return courses.length;
}

async function seedResources(content: ReturnType<typeof loadContent>): Promise<number> {
  const page = content["resources"];
  if (!page) return 0;
  const resources = extractResources(page);
  for (const r of resources) {
    await pool.query(
      `INSERT INTO resources (slug, title, description, image, cta_label, cta_url, kind, sort, published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (slug) DO NOTHING`,
      [r.slug, r.title, r.description, r.image, r.ctaLabel, r.ctaUrl, r.kind, r.sort]
    );
  }
  return resources.length;
}

async function seedPages(content: ReturnType<typeof loadContent>): Promise<number> {
  let count = 0;

  const home = content["home"];
  if (home) {
    const heroTitle = firstTextMatching(home.texts, "h2");
    const heroSubtitleIdx = home.texts.findIndex((t) => t.tag === "h2" && t.text.trim() === heroTitle);
    const heroSubtitle = firstTextMatching(home.texts, "p", heroSubtitleIdx + 1);
    const pillars = ["PROVEN", "PERSONAL", "PREMIUM"].map((label) => {
      const idx = home.texts.findIndex((t) => t.tag === "h4" && t.text.trim() === label);
      return {
        title: label,
        description: idx !== -1 ? firstTextMatching(home.texts, "p", idx + 1) : "",
      };
    });
    const valueProps = ["More Freedom", "More Financial Stability", "More Flexibility"].map((label) => {
      const idx = home.texts.findIndex((t) => t.tag === "h4" && t.text.trim() === label);
      return {
        title: label,
        description: idx !== -1 ? firstTextMatching(home.texts, "p", idx + 1) : "",
      };
    });

    await pool.query(
      `INSERT INTO pages (slug, title, description, sections) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [
        "home",
        home.title,
        home.description,
        JSON.stringify({
          hero: {
            title: heroTitle,
            subtitle: heroSubtitle,
            cta: { label: "Apply for 1:1 Coaching", href: "/apply" },
          },
          valueProps,
          pillars,
        }),
      ]
    );
    count++;
  }

  const about = content["about"];
  if (about) {
    const heroTitle = firstTextMatching(about.texts, "h2");
    const body = firstTextMatching(about.texts, "p", about.texts.findIndex((t) => t.tag === "h2") + 1);
    await pool.query(
      `INSERT INTO pages (slug, title, description, sections) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [
        "about",
        about.title,
        about.description,
        JSON.stringify({
          hero: { title: heroTitle, body },
        }),
      ]
    );
    count++;
  }

  const workWithMe = content["work-with-me"];
  if (workWithMe) {
    const eyebrow = firstTextMatching(workWithMe.texts, "h4");
    const titleIdx = workWithMe.texts.findIndex((t) => t.tag === "h2");
    const title = titleIdx !== -1 ? workWithMe.texts[titleIdx].text.trim() : "";
    const subtitle = firstTextMatching(workWithMe.texts, "h2", titleIdx + 1);
    const body = firstTextMatching(workWithMe.texts, "p", titleIdx + 1);
    await pool.query(
      `INSERT INTO pages (slug, title, description, sections) VALUES ($1,$2,$3,$4)
       ON CONFLICT (slug) DO NOTHING`,
      [
        "work-with-me",
        workWithMe.title,
        workWithMe.description,
        JSON.stringify({
          hero: {
            eyebrow,
            title,
            subtitle,
            body,
            cta: { label: "Apply Now", href: "/apply" },
          },
        }),
      ]
    );
    count++;
  }

  return count;
}

async function seedSettings(content: ReturnType<typeof loadContent>): Promise<void> {
  const contact = content["contact"];
  const contactEmail =
    contact?.texts.find((t) => t.tag === "p" && /@/.test(t.text) && !t.text.includes(" "))?.text.trim() ??
    "bossclinician@gmail.com";

  const nav = [
    { label: "About Yvette", href: "/about" },
    { label: "Work With Me", href: "/work-with-me" },
    { label: "Courses", href: "/courses" },
    { label: "Free Resources", href: "/resources" },
    { label: "Retreats", href: "/retreats" },
    { label: "Blog", href: "/blog" },
  ];

  const footer = {
    legalLinks: [
      { label: "Financial Disclaimer", href: "/financialdisclaimer" },
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Use", href: "/terms-of-use" },
      { label: "Disclaimer", href: "/disclaimer" },
      { label: "Terms of Service", href: "/terms-of-service" },
    ],
    tagline: "Join Our Free Trial",
    taglineSub: "Get started today before this once in a lifetime opportunity expires.",
  };

  const contactInfo = {
    email: contactEmail,
    instagram: "@profitwithyvette",
  };

  const rows: [string, unknown][] = [
    ["nav", nav],
    ["footer", footer],
    ["contact", contactInfo],
  ];

  for (const [key, value] of rows) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

export async function runSeedIfEmpty(): Promise<void> {
  await ensureAdminUser();

  if (await isAlreadySeeded()) {
    // eslint-disable-next-line no-console
    console.log("[seed] Content already seeded — skipping.");
    return;
  }

  const content = loadContent();

  const [blogCount, testimonialCount, courseCount, resourceCount, pageCount] = await Promise.all([
    seedBlogPosts(content),
    seedTestimonials(content),
    seedCourses(content),
    seedResources(content),
    seedPages(content),
  ]);
  await seedSettings(content);
  await markSeeded();

  // eslint-disable-next-line no-console
  console.log(
    `[seed] Seeded ${blogCount} blog posts, ${testimonialCount} testimonials, ${courseCount} courses, ${resourceCount} resources, ${pageCount} pages.`
  );
}

// Allow `npm run seed` to invoke this directly.
if (require.main === module) {
  runSeedIfEmpty()
    .then(() => pool.end())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[seed] Failed:", err);
      process.exit(1);
    });
}
