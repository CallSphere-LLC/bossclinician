-- Sheet row 245 (Club): remove the replacement-income claim and the unfilled [LINK] placeholder from the-club offer copy.
UPDATE offers SET description = replace(description,
  'build a private practice that replaces their salary, without losing',
  'build a private practice without losing'), updated_at = now()
WHERE slug = 'the-club' AND description LIKE '%replaces their salary%';
UPDATE offers SET description = replace(description, '[LINK]', 'www.bossclinician.com/continuing-education-boss-clinician'), updated_at = now()
WHERE slug = 'the-club' AND description LIKE '%[LINK]%';
