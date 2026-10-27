-- Optional in-course promotions. These links never grant or restrict access.
CREATE TABLE IF NOT EXISTS course_addons (
  course_id integer NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  offer_id integer NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  description varchar(300) NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0 CHECK (sort BETWEEN 0 AND 999),
  PRIMARY KEY(course_id,offer_id)
);
-- Match identities as well as slugs. Do not publish the course or change billing.
INSERT INTO course_addons(course_id,offer_id,description,sort)
SELECT c.id,o.id,x.description,x.sort
FROM courses c CROSS JOIN (VALUES
  (21,'private-practice-protection-pack','Explore the Private Practice Protection Pack.',10),
  (40,'the-lounge','Explore Lounge membership and its current purchase options.',20)
) AS x(id,slug,description,sort)
JOIN offers o ON o.id=x.id AND o.slug=x.slug AND o.status='published'
WHERE c.id=52 AND c.slug='the-boss-move'
ON CONFLICT DO NOTHING;
