import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { resourcesRepo } from "../../db/repos";

export const resourcesRouter = Router();

resourcesRouter.get(
  "/resources",
  asyncHandler(async (_req, res) => {
    const items = await resourcesRepo.list({ where: "published = true" });
    res.json(items);
  })
);
