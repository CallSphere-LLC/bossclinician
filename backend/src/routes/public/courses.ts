import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { coursesRepo } from "../../db/repos";

export const coursesRouter = Router();

coursesRouter.get(
  "/courses",
  asyncHandler(async (_req, res) => {
    const items = await coursesRepo.list({ where: "published = true" });
    res.json(items);
  })
);
