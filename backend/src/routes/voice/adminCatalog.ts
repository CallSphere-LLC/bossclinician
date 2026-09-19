import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden } from "../../utils/httpError";
import { identityFromRequest } from "./session";
import { adminCatalog, prepareAdminOperation } from "../../services/voice/adminCatalog";

export const voiceAdminCatalogRouter = Router();
export const adminOperationRequestSchema = z.object({
  resource: z.string().max(40),
  action: z.enum(["create", "update", "delete"]),
  id: z.union([z.string().max(200), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
    .transform((value) => String(value)).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});
voiceAdminCatalogRouter.use("/admin-catalog", asyncHandler(async (req, res, next) => {
  if ((await identityFromRequest(req, res)).audience !== "admin") throw forbidden("Administrator sign-in is required.");
  res.setHeader("Cache-Control", "no-store");
  next();
}));
voiceAdminCatalogRouter.get("/admin-catalog", asyncHandler(async (req, res) => {
  try { res.json(adminCatalog(typeof req.query.resource === "string" ? req.query.resource : undefined, typeof req.query.action === "string" ? req.query.action : undefined)); }
  catch (error) { throw badRequest(error instanceof Error ? error.message : "Unknown operation."); }
}));
voiceAdminCatalogRouter.post("/admin-catalog/prepare", asyncHandler(async (req, res) => {
  const request = adminOperationRequestSchema.safeParse(req.body);
  if (!request.success) throw badRequest("Invalid operation.", request.error.flatten());
  try { res.json(prepareAdminOperation(request.data)); }
  catch (error) { throw badRequest(error instanceof Error ? error.message : "Invalid operation."); }
}));
