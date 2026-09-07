-- Course → Module → Content.
--
-- The approved structure drops the visible Submodule level: a course contains
-- Modules, and a Module directly contains its learning content. Requirement 16
-- is explicit that this must not be done by deleting anything, so every
-- submodule is *promoted* to a Module rather than removed.
--
-- Nothing is dropped and nothing is detached:
--   * every submodule row survives, as a top-level module;
--   * its lessons and quizzes stay attached to it, so no content moves owner;
--   * `parent_id` stays on the table, unused, so this is reversible from a
--     backup and so an older deploy reading the column still works.
--
-- Ordering is preserved as it read on screen: a promoted submodule lands
-- immediately after the module it used to sit inside, in its original order.

DO $$
DECLARE
  has_submodules BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM course_modules WHERE parent_id IS NOT NULL)
    INTO has_submodules;

  IF NOT has_submodules THEN
    RETURN;
  END IF;

  -- The order the admin currently sees: each top-level module, then its
  -- submodules in their own order. `row_number()` over that gives the new
  -- flat ordering directly.
  WITH ordered AS (
    SELECT
      m.id,
      row_number() OVER (
        PARTITION BY m.course_id
        ORDER BY
          -- Group each submodule with its parent...
          COALESCE(parent.sort, m.sort),
          COALESCE(parent.id, m.id),
          -- ...and put the parent itself first within that group.
          CASE WHEN m.parent_id IS NULL THEN 0 ELSE 1 END,
          m.sort,
          m.id
      ) - 1 AS new_sort
    FROM course_modules m
    LEFT JOIN course_modules parent ON parent.id = m.parent_id
  )
  UPDATE course_modules m
     SET sort      = o.new_sort,
         parent_id = NULL,
         updated_at = now()
    FROM ordered o
   WHERE o.id = m.id;
END $$;
