import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { testimonialsRepo } from "../../db/repos";

export const testimonialsRouter = Router();

testimonialsRouter.get(
  "/testimonials",
  asyncHandler(async (_req, res) => {
    const items = await testimonialsRepo.list({ where: "published = true" });
    res.json(items);
  })
);
