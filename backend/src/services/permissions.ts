import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../utils/httpError";

/**
 * What each kind of admin is allowed to do.
 *
 * The matrix is deliberately a plain data structure rather than a set of
 * scattered `req.user.role === "admin"` checks: the question "who can refund a
 * payment" has to be answerable by reading one file, and a new role has to be a
 * new row rather than a search through every router.
 *
 * Two rules the rest of the platform depends on:
 *
 *  - `owner` is unconditional. It is the account that owns the business, and a
 *    permission it lacks is a permission nobody has — there is no support desk
 *    to escalate to.
 *  - A role that is not in this table gets nothing. A typo in a role column, or
 *    a role added to the database CHECK before it was added here, must fail
 *    closed; the alternative is a role that silently inherits everything.
 */

export const ROLES = ["owner", "admin", "marketing", "support", "coach"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  "products",
  "offers",
  "orders",
  "contacts",
  "marketing",
  "community",
  "coaching",
  "website",
  "reports",
  "settings",
  "admins",
] as const;
export type Module = (typeof MODULES)[number];

/**
 * `view` reads a module's screens; `manage` changes anything inside it.
 *
 * `orders.refund_request` is the one action that is neither: support has to be
 * able to raise a refund without being able to edit an order, and folding it
 * into `orders.manage` would hand the same person the ability to rewrite what a
 * customer was charged.
 */
export type Permission = `${Module}.view` | `${Module}.manage` | "orders.refund_request";

function everything(): Permission[] {
  const all: Permission[] = ["orders.refund_request"];
  for (const module of MODULES) {
    all.push(`${module}.view`, `${module}.manage`);
  }
  return all;
}

const MARKETING: Permission[] = [
  "contacts.view",
  "contacts.manage",
  "marketing.view",
  "marketing.manage",
  "website.view",
  "website.manage",
  // Read-only on the two things a campaign points at and is measured by. A
  // campaign written without being able to see the offer it sells, or how the
  // last one performed, is a campaign written blind.
  "offers.view",
  "products.view",
  "reports.view",
];

const SUPPORT: Permission[] = [
  "contacts.view",
  "orders.view",
  "orders.refund_request",
  // Answering "what did they actually buy" needs the offer behind the order.
  "offers.view",
  "products.view",
];

const COACH: Permission[] = ["coaching.view", "coaching.manage"];

/** Everything except handing out admin accounts, which stays with the owner. */
const ADMIN: Permission[] = everything().filter((p) => p !== "admins.manage");

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(everything()),
  admin: new Set(ADMIN),
  marketing: new Set(MARKETING),
  support: new Set(SUPPORT),
  coach: new Set(COACH),
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** The single authority on whether a role may do something. */
export function can(role: string, permission: Permission): boolean {
  if (!isRole(role)) return false;
  if (role === "owner") return true;
  return MATRIX[role].has(permission);
}

/** Every permission a role holds — for the UI, and for tests that assert the shape. */
export function permissionsForRole(role: string): Permission[] {
  if (!isRole(role)) return [];
  return [...MATRIX[role]].sort();
}

/**
 * A coach's reach is limited to their own records even inside the module they
 * own, and that limit is a row filter rather than a permission — "coaching.view
 * but only mine" is not something a boolean can express. Routers that list
 * sessions ask this and add the `coach_id = me` clause.
 */
export function limitedToOwnRecords(role: string): boolean {
  return role === "coach";
}

/**
 * The roles, described as what a person can do rather than as a permission
 * matrix. This is what the "Team" screen shows when Yvette picks a role for
 * somebody, so it is written for her and not for a developer.
 */
export interface RoleDescriptor {
  role: Role;
  label: string;
  summary: string;
  canDo: string[];
  cannotDo: string[];
}

export const ROLE_DESCRIPTORS: RoleDescriptor[] = [
  {
    role: "owner",
    label: "Owner",
    summary: "You. Full run of the business, including adding and removing people here.",
    canDo: ["Everything, everywhere", "Add, remove and change the people on this list"],
    cannotDo: [],
  },
  {
    role: "admin",
    label: "Manager",
    summary: "Runs the whole business day to day, but can't change who has access.",
    canDo: [
      "Products, offers, payments and refunds",
      "Contacts, emails, the website and the community",
      "Settings and reports",
    ],
    cannotDo: ["Add or remove people from this list"],
  },
  {
    role: "marketing",
    label: "Marketing",
    summary: "Writes and sends. Looks after your contacts, emails and website.",
    canDo: [
      "Your contact list, tags and segments",
      "Emails, campaigns, funnels and forms",
      "Blog posts, pages and testimonials",
      "Seeing how it all performed",
    ],
    cannotDo: ["Taking payments or issuing refunds", "Settings", "Adding people"],
  },
  {
    role: "support",
    label: "Customer support",
    summary: "Answers customers. Can look things up and ask for a refund, nothing more.",
    canDo: [
      "Looking up a customer and their orders",
      "Asking for a refund to be issued",
    ],
    cannotDo: ["Changing an order or a price", "Emails and the website", "Settings"],
  },
  {
    role: "coach",
    label: "Coach",
    summary: "Sees their own coaching sessions and nothing else.",
    canDo: ["Their own coaching calendar, notes and session files"],
    cannotDo: [
      "Anyone else's sessions",
      "Customers, payments, emails or the website",
      "Settings",
    ],
  },
];

/**
 * Route guard. Runs after `requireAuth`, which is what puts the role on the
 * request — a missing `req.user` here means the router was mounted without
 * authentication, and that is a 401 rather than a 403 so the mistake is
 * distinguishable from a genuine refusal.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role) {
      next(unauthorized("Missing bearer token"));
      return;
    }
    if (!can(role, permission)) {
      next(forbidden("Your account doesn't have access to that."));
      return;
    }
    next();
  };
}

/** Guard for the handful of actions only an owner may take. */
export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "owner") {
    next(forbidden("Only the owner can do that."));
    return;
  }
  next();
}
