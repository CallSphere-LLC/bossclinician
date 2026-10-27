-- Synthetic-only fixture: run with psql -v ON_ERROR_STOP=1 in an empty database.
BEGIN;
CREATE TEMP TABLE courses(id integer, slug text, image text);
CREATE TEMP TABLE products(id integer, slug text, kind text, course_id integer, thumbnail_url text, updated_at timestamptz);
CREATE TEMP TABLE offers(id integer, slug text, status text, redirect_url text, price_cents integer, billing_type text, updated_at timestamptz);
INSERT INTO courses VALUES
 (52,'the-boss-move','/uploads/boss.png'),(60,'the-lounge-vip','/uploads/vip.png'),
 (61,'the-practice-elevation','/uploads/elevation.png'),(99,'unrelated','/uploads/other.png');
INSERT INTO products VALUES
 (44,'the-boss-move','course',52,'',null),(64,'the-lounge-vip','course',60,null,null),
 (65,'the-practice-elevation','course',61,'  ',null),
 (66,'the-boss-move','course',52,'/custom.png',null),
 (67,'the-boss-move','course',99,'',null),(68,'unrelated','course',99,'',null);
INSERT INTO offers VALUES
 (39,'the-club','published','/the-club-ty',199700,'one_time',null),
 (40,'the-lounge','published','',19700,'recurring',null),
 (41,'the-lounge-vip','published','',34700,'recurring',null),
 (109,'the-lounge-vip-free','draft','',0,'free',null),
 (110,'unrelated','published','https://example.com/thanks',12700,'one_time',null);
CREATE TEMP TABLE before_offers AS SELECT id,price_cents,billing_type FROM offers;
\ir ../migrations/167_membership_welcome_images.sql
CREATE TEMP TABLE first_products AS TABLE products;
CREATE TEMP TABLE first_offers AS TABLE offers;
\ir ../migrations/167_membership_welcome_images.sql
DO $$
BEGIN
 IF (SELECT count(*) FROM products WHERE id IN(44,64,65) AND thumbnail_url LIKE '/uploads/%') <> 3 THEN
   RAISE EXCEPTION 'Missing linked course artwork'; END IF;
 IF (SELECT thumbnail_url FROM products WHERE id=66) <> '/custom.png' OR
    EXISTS(SELECT 1 FROM products WHERE id IN(67,68) AND thumbnail_url <> '') THEN
   RAISE EXCEPTION 'Unrelated/custom/mismatched image was changed'; END IF;
 IF (SELECT count(*) FROM offers WHERE id IN(40,41) AND redirect_url='/lounge-confirmed') <> 2 OR
    (SELECT redirect_url FROM offers WHERE id=39) <> '/the-club-ty' OR
    (SELECT redirect_url FROM offers WHERE id=109) <> '' OR
    (SELECT redirect_url FROM offers WHERE id=110) <> 'https://example.com/thanks' THEN
   RAISE EXCEPTION 'Wrong offer destination changed'; END IF;
 IF EXISTS((SELECT id,price_cents,billing_type FROM offers EXCEPT SELECT * FROM before_offers)) THEN
   RAISE EXCEPTION 'Billing changed'; END IF;
 IF EXISTS(TABLE products EXCEPT TABLE first_products) OR EXISTS(TABLE offers EXCEPT TABLE first_offers) THEN
   RAISE EXCEPTION 'Migration is not idempotent'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: images, custom/mismatched/unrelated preservation, exact routes, billing unchanged, idempotence' AS result;
