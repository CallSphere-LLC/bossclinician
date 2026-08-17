import { resourcesRepo } from "../../db/repos";
import { resourceSchema, resourceUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";

export const adminResourcesRouter = buildAdminCrudRouter(
  resourcesRepo,
  resourceSchema,
  resourceUpdateSchema
);
