# Integration fixups (apply after agents finish)

## Contact info — canonical
- Public contact email: **bossclinician@gmail.com** ("Send me an email at…" on /contact).
- Secondary/footer/from: **yvette@bossclinician.com**.
- **REMOVE contamination** everywhere it leaked from the scrape (contact page, settings seed, any "help" copy):
  - `hello@carolineflett.com`, the name "Caroline", the whole "When you purchase a product and can't log in…" login-troubleshooting block, and "cancel your subscription membership to the Boss Clinician Lounge" boilerplate. These are generic Kajabi shared-template help text, NOT real Boss Clinician content. AI KB already excluded them.
- Retreats: nav has a "RETREATS" link but no dedicated scraped page in the core set (retreat funnel pages exist). Frontend can point Retreats to work-with-me or a simple section until content provided.

## Verify in agent output
- Frontend `/contact` copy = "Hey There! / Have a question or want to work with me? / Send me an email at bossclinician@gmail.com" + program blurb. No Caroline text.
- Backend `settings` contact = bossclinician@gmail.com. Leads notification default to yvette@bossclinician.com.
- No `carolineflett` string anywhere: `grep -ri carolineflett frontend/src backend/src` must be empty.
