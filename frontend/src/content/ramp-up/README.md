# Ramp-Up Rate Formula source reproduction

Source: https://www.bossclinician.com/rampedrevenue
Captured: 21 October 2026, in response to QA tracker row 139.

The static template preserves the owner's source sections, images, typography,
backgrounds and responsive spacing. All scripts, embedded frames, forms,
inline event handlers and Kajabi editor/reveal attributes were removed.
FAQs use native details/summary elements. All 48 referenced image/font assets
are local; assets.json maps each source URL to its local file.

source.css contains the source theme and section styles, with every selector
scoped to .ramp-up-page. It must never be replaced by unscoped theme CSS.
The page wrapper replaces price and checkout placeholders from the live
catalogue and preserves owned/unavailable behavior.

To revise copy, edit source.html as trusted application source. Do not accept
runtime/user HTML here. Do not restore Kajabi scripts, tracking or checkout URLs.
