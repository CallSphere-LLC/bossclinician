import { blogRepo } from "../../db/repos";
import { blogSchema, blogUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";

export const adminBlogRouter = buildAdminCrudRouter(
  blogRepo,
  blogSchema,
  blogUpdateSchema,
  "created_at DESC"
);
