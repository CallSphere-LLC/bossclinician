-- Owner answers 22 Nov 2026, item 4: retreat room availability and travel facts.
--
-- 1. Shared room: not available for public booking. Yvette may privately offer
--    one shared room ($4,500 per person) to someone bringing a friend. The offer
--    stays published, priced and intact (pricing options 23/26/34 unchanged) so
--    she can send a personal invitation link from Admin > Offers > Bali Shared
--    Room > Checkout requirements > Invitations, the same mechanism as the
--    Boardroom (migration 185). Anyone else opening /checkout/bali-shared-room
--    sees "Enrollment is by invitation" instead of a form.
--    Existing shared-room guests are untouched: this changes no purchase,
--    access grant, payment plan, subscription, price or status. The flag is
--    read only by checkout, cart, upsell and payment-link paths.
--    Gifting and abandoned-checkout reminders are off, as for the Boardroom: a
--    reminder link carries no invitation and would land on the notice.
INSERT INTO offer_checkout_requirements (offer_id, invitation_required)
SELECT o.id, true FROM offers o WHERE o.slug = 'bali-shared-room'
ON CONFLICT (offer_id) DO UPDATE SET invitation_required = true
 WHERE offer_checkout_requirements.invitation_required IS DISTINCT FROM true;

UPDATE offers
   SET allow_gifting = false, recovery_enabled = false, show_in_cart = false, updated_at = now()
 WHERE slug = 'bali-shared-room'
   AND (allow_gifting OR recovery_enabled OR show_in_cart);

-- 2. Private-room welcome next steps (sent to new buyers only): the owner's
--    travel wording. Designated group transfers during June 15-20, pickup
--    windows coordinated with guests; nothing implies unlimited transport.
UPDATE offers
   SET welcome_next_steps = replace(welcome_next_steps,
         'Book your flights to I Gusti Ngurah Rai International Airport (DPS), Bali, Indonesia. Plan to arrive on June 15, 2027 and depart on June 20, 2027. Luxury group shuttle transfers from the airport to the villa are included in your package.',
         'Book your flights to Ngurah Rai International Airport, Denpasar (DPS). Arrival is June 15, 2027 and checkout is June 20, 2027. Airport transportation is provided during June 15–20 through designated group transfers. Exact pickup windows will be coordinated with guests.'),
       updated_at = now()
 WHERE slug = 'bali-private-room'
   AND position('Book your flights to I Gusti Ngurah Rai International Airport (DPS), Bali, Indonesia.' IN welcome_next_steps) > 0;
