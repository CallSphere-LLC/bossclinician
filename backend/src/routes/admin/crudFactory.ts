import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";

interface Repo<T extends { id: number }> {
  list(opts?: { where?: string; params?: unknown[]; orderBy?: string }): Promise<T[]>;
  getById(id: number): Promise<T | null>;
  create(data: Record<string, unknown>): Promise<T>;
  update(id: number, data: Record<string, unknown>): Promise<T | null>;
  remove(id: number): Promise<boolean>;
}

/**
 * Builds standard GET(list)/GET(:id)/POST/PUT(:id)/DELETE(:id) admin routes
 * for a resource backed by a createCrudRepo repository.
 */
export function buildAdminCrudRouter<T extends { id: number }>(
  repo: Repo<T>,
  createSchema: z.ZodType<Record<string, unknown>>,
  updateSchema: z.ZodType<Record<string, unknown>>,
  orderBy?: string
): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const items = await repo.list(orderBy ? { orderBy } : undefined);
      res.json(items);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw badRequest("Invalid id");
      const item = await repo.getById(id);
      if (!item) throw notFound("Not found");
      res.json(item);
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
      const item = await repo.create(parsed.data);
      res.status(201).json(item);
    })
  );

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw badRequest("Invalid id");
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());
      const item = await repo.update(id, parsed.data);
      if (!item) throw notFound("Not found");
      res.json(item);
    })
  );

  // Deleting is gated at the mount, with the rest of the module's writes — see
  // the `moduleGate` in routes/admin/index.ts. It used to be `requireRole("admin")`
  // here, which since the roles migration excluded `owner`: Yvette's own account
  // is the owner, so the delete button on her blog, course, testimonial and
  // resource screens answered 403 for her and worked for everybody else.
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw badRequest("Invalid id");
      const removed = await repo.remove(id);
      if (!removed) throw notFound("Not found");
      res.json({ ok: true });
    })
  );

  return router;
}
