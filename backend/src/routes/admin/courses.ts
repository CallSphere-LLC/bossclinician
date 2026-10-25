import { coursesRepo } from "../../db/repos";
import { courseSchema, courseUpdateSchema } from "../../validation/schemas";
import { buildAdminCrudRouter } from "./crudFactory";
import { adminCoursePreviewRouter } from "./coursePreview";
import { adminCourseHubRouter } from "./courseHub";
import { ensureCourseProduct } from "../../services/courseProduct";

// A course row that a download (051), service audit, or a one-to-one coaching programme (120)
// has taken over is not a course to the owner, so the list leaves it out. The
// row is kept and still opens by id: a coaching programme's lessons are edited
// at /admin/courses/:id/curriculum from its card on the Coaching page.
//
// Creating a course makes its product with it (sheet row 160): access is
// granted to products, so a course made on its own could be built and put on
// the website and still never be bought or given to anybody. Idempotent, and the
// course's Offers tab asks again before attaching anything, so a failure here
// leaves a course that is fixed by the next click rather than a broken one.
export const adminCoursesRouter = buildAdminCrudRouter(
  {
    ...coursesRepo,
    list: (opts) => coursesRepo.list({ ...opts, where: "NOT EXISTS (SELECT 1 FROM products p WHERE p.legacy_course_id=courses.id AND p.kind IN ('download','coaching','access_group'))" }),
    create: async (data) => {
      const course = await coursesRepo.create(data);
      try {
        await ensureCourseProduct(Number(course.id));
      } catch (err) {
        console.error(`[courses] course ${course.id} created without its product:`, err);
      }
      return course;
    },
  },
  courseSchema,
  courseUpdateSchema,
);

// "Preview as student": read-only, admin-authenticated, in the member API's
// shapes. Two segments, so it never competes with the CRUD router's `/:id`.
adminCoursesRouter.use("/:courseId/preview", adminCoursePreviewRouter);

// The course's Offers, Customers and Settings tabs (routes/admin/courseHub.ts).
adminCoursesRouter.use("/:courseId/hub", adminCourseHubRouter);
