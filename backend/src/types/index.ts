export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface JwtPayload {
  sessionId?: string;
  sub: number;
  email: string;
  role: string;
}

export interface BlogPost {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  coverImage: string | null;
  tags: string[];
  author: string;
  readMinutes: number;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  priceText: string;
  priceCents: number | null;
  currency: string;
  stripePriceId: string | null;
  image: string | null;
  url: string;
  features: unknown;
  sort: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Testimonial {
  id: number;
  name: string;
  credential: string;
  quote: string;
  /**
   * Practice or business name shown under the attribution. The home page has
   * always rendered this, but the column did not exist — so API-backed
   * testimonials silently dropped it and only the bundled fallback showed it.
   */
  practice: string | null;
  image: string | null;
  sort: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: number;
  slug: string;
  title: string;
  description: string;
  image: string | null;
  ctaLabel: string;
  ctaUrl: string;
  kind: string;
  sort: number;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  slug: string;
  title: string;
  description: string;
  sections: unknown;
  updatedAt: string;
}

export interface Lead {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  source: string;
  meta: unknown;
  status: string;
  createdAt: string;
}

export interface Subscriber {
  id: number;
  email: string;
  source: string;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: import("./index").JwtPayload;
    }
  }
}
