#!/usr/bin/env node
/**
 * One-off: uploads the approved Club and Boardroom agreements and switches on
 * their checkout requirements (QA row 202). Dry run unless --apply is passed.
 *
 *   node scripts/activate-program-agreements.js --club /tmp/04_club.pdf
 *   node scripts/activate-program-agreements.js --club /tmp/04_club.pdf --apply
 *   node scripts/activate-program-agreements.js --boardroom /tmp/b.pdf --approve-sha <sha256> --apply
 *   node scripts/activate-program-agreements.js --rollback [--apply]
 *
 * Creating a contract follows POST /admin/contracts (routes/admin/contracts.ts)
 * and saving the settings follows PUT /admin/contracts/offers/:id/requirements
 * (routes/admin/checkoutRequirements.ts), guards included. It stops short of the
 * route's delete of other required agreements: this only ever adds.
 *
 * It sends nothing. The mailer is not loaded, nothing is assigned to any member
 * and no invitation is created. A PDF is only accepted if its sha256 is listed in
 * APPROVED below or named by --approve-sha, so a buyer cannot be asked to sign a
 * file nobody has read. The words of every setting are copied from the agreement
 * itself; a setting the agreement does not state stays blank.
 *
 * Plain CommonJS because the runtime image has no tsx: it loads the compiled
 * services from dist. Runs from /app/scripts once deployed, or from /tmp after a
 * kubectl cp.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DIST = fs.existsSync(path.join(__dirname, "..", "dist")) ? path.join(__dirname, "..", "dist") : "/app/dist";
const { pool } = require(path.join(DIST, "db", "pool"));
const { env } = require(path.join(DIST, "config", "env"));
const { protectedRef } = require(path.join(DIST, "services", "signedUrls"));
const { writeStoredMedia, removeStoredMedia } = require(path.join(DIST, "services", "objectStorage"));
const { readContractSource } = require(path.join(DIST, "services", "contractStorage"));
const requirementsService = require(path.join(DIST, "services", "checkoutRequirements"));

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Files someone has read through. The Boardroom PDF of 30 Oct is deliberately not
 * here (d434932b...): its last page still reads "IMPLEMENTATION NOTE - REMOVE
 * BEFORE SENDING FOR SIGNATURE ... Have counsel approve", and its document title
 * says "Final Draft for Attorney Review", which shows on the browser tab.
 */
const APPROVED = new Set(["f116304a78c1dfb2d2e437f1cd43b038729136695065ad7f369c60795000a28e", "c4b5b133bb19a4c9d021830545b3a95fee8a00783d797a809b19e54e2054d710"]);

const PROGRAMS = {
  club: {
    slug: "the-club",
    contractTitle: "The Boss Clinician Club — Program Enrollment Agreement",
    invitationRequired: false,
    programTerm:
      "Six months. The Boss Clinician Club is a fixed-term business education and coaching program, not a cancel-anytime monthly subscription.",
    termMonths: 6,
    includedBenefits:
      "The Boss Move curriculum, Boss Move Exit Dashboard, group coaching, community support, and other educational resources specifically included in the Participant's accepted enrollment offer.",
    refundTerms:
      "14-Day Action-Based Tuition Guarantee. Join The Club and do the work for 14 days. Complete your onboarding, work through Start Here and Module 01, finish the Module 01 worksheets, and attend or watch your first coaching call. If you have completed all of these requirements and still do not believe The Club is a powerful investment in your practice, submit your completed work within 14 calendar days of enrollment, and we will refund your tuition. Refund requests must be received at support@bossclinician.com before the guarantee period expires. After the 14-day guarantee period expires, program tuition and installment payments are nonrefundable, except as required by applicable law or expressly agreed to in writing by Boss Clinician, LLC.",
    refundWindowDays: 14,
    obligationsNote:
      "Installments, when offered, are payments toward a fixed-term program investment, not month-to-month cancelable membership dues. A Participant may voluntarily discontinue participation; however, doing so after the applicable refund period does not automatically cancel the Agreement, eliminate valid remaining installments, or create an entitlement to a prorated refund. Outstanding installments remain payable according to the accepted payment schedule, subject to applicable law and any written modification or release authorized by Boss Clinician, LLC. The Club does not automatically renew at the conclusion of its purchased program term unless a separate renewal arrangement has been expressly disclosed and authorized.",
    offerChanges: {},
  },
  boardroom: {
    slug: "the-boss-boardroom",
    contractTitle: "The Boardroom Mastermind — Evergreen Executive Advisory Agreement",
    invitationRequired: true,
    programTerm:
      "Twelve months. The Boardroom is a fixed-term program lasting twelve months from the Participant's individualized start date recorded at enrollment, unless a different term is expressly accepted in writing.",
    termMonths: 12,
    // Final PDF supplied by the owner on 2 November 2026 (UTC), section 1.
    includedBenefits: "4 quarterly CEO strategy intensives (3-4 hours each); 8 momentum check-ins (60 minutes each); 2 private 45-minute CEO strategy sessions; 2 guest expert sessions; up to 2 voice-note questions per month, with a response targeted within 2 business days, excluding announced closures and holidays; CEO Dashboard, Living Business Plan, Executive Circle, Executive Resource Vault and designated Practice Elevation course content for the individual 12-month term. Done-for-you operations and payer credentialing are not included.",
    refundTerms:
      "Subject to applicable law and express written exceptions, all Boardroom payments are final and nonrefundable. Voluntary nonattendance, dissatisfaction with results, schedule or business changes, and a decision to stop participating do not create a right to a prorated refund, program credit, or early release from valid installments. This policy does not eliminate nonwaivable rights or remedies, including those arising from a material breach or failure by Company to provide agreed services.",
    // Null, not 0: the agreement has no refund window, and 0 would print a deadline.
    refundWindowDays: null,
    obligationsNote:
      "A pay-in-installments arrangement pays the agreed fixed-term tuition; it is not a cancel-anytime monthly subscription. Charges are authorized only according to the disclosed, accepted schedule. There is no automatic renewal into another Boardroom term without a separately disclosed and authorized agreement. Participant may cease attending but remains responsible for valid amounts payable under the accepted Enrollment Record.",
    // A reminder link has no invitation token, so it would land on the notice.
    offerChanges: { allow_gifting: false, recovery_enabled: false },
  },
};

function parseArgs(argv) {
  const args = { apply: false, rollback: false, approved: new Set(APPROVED), files: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--apply") args.apply = true;
    else if (flag === "--rollback") args.rollback = true;
    else if (flag === "--club" || flag === "--boardroom") args.files[flag.slice(2)] = argv[(i += 1)];
    else if (flag === "--approve-sha") args.approved.add(String(argv[(i += 1)]).toLowerCase());
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

/** The PDF's own document title, which a browser shows on the tab. Best effort. */
function pdfTitle(bytes) {
  const raw = bytes.toString("latin1");
  const hex = /\/Title\s*<([0-9A-Fa-f]+)>/.exec(raw);
  if (hex) {
    const data = Buffer.from(hex[1], "hex");
    if (data[0] === 0xfe && data[1] === 0xff && data.length % 2 === 0) return data.subarray(2).swap16().toString("utf16le");
    return data.toString("latin1");
  }
  const plain = /\/Title\s*\(([^)]*)\)/.exec(raw);
  return plain ? plain[1] : "";
}

function loadPdf(program, file, approved) {
  const bytes = fs.readFileSync(file);
  // The checks POST /admin/contracts makes on an upload.
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`${file}: the contract must be a valid PDF under 10 MB.`);
  }
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (!approved.has(sha256)) {
    throw new Error(`${program.slug}: ${path.basename(file)} (sha256 ${sha256}) is not an approved file. Read it first, then pass --approve-sha ${sha256}.`);
  }
  const title = pdfTitle(bytes);
  if (/draft|attorney/i.test(title)) console.warn(`WARNING ${program.slug}: this PDF's document title is "${title}", which buyers see on the browser tab.`);
  return { bytes, sha256, title };
}

async function findOffer(slug) {
  const found = await pool.query(
    `SELECT o.id, o.slug, o.title, o.status, o.allow_gifting, o.recovery_enabled,
            (SELECT count(*)::int FROM offer_payment_links l WHERE l.offer_id = o.id AND l.active) AS live_links
       FROM offers o WHERE o.slug = $1`,
    [slug]
  );
  if (!found.rows[0]) throw new Error(`No offer with slug ${slug}`);
  return found.rows[0];
}

/** The same contract by content, then by title. A changed file is a new version: a person decides. */
async function findContract(program, sha256) {
  const found = await pool.query(
    `SELECT id, title, pdf_sha256 FROM participant_contracts WHERE pdf_sha256 = $1 OR title = $2 ORDER BY (pdf_sha256 = $1) DESC, id DESC`,
    [sha256, program.contractTitle]
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.pdf_sha256 !== sha256) {
    throw new Error(`"${row.title}" (contract ${row.id}) already exists with a different PDF. Upload the new version from Products > Contracts and swap it on the offer.`);
  }
  if (/draft/i.test(row.title)) throw new Error(`This PDF is already contract ${row.id}, titled "${row.title}". Draft-titled contracts can't be required at checkout.`);
  return { ...row, id: Number(row.id) };
}

/** POST /admin/contracts, minus the media-library lookup that finds the upload. */
async function createContract(program, pdf) {
  if (/draft/i.test(program.contractTitle)) throw new Error("A required contract's title can't say draft.");
  const reference = protectedRef(`contracts/${crypto.randomUUID()}.pdf`);
  await writeStoredMedia(reference, pdf.bytes, "application/pdf");
  try {
    const stored = await readContractSource(reference, MAX_PDF_BYTES);
    if (!stored || crypto.createHash("sha256").update(stored).digest("hex") !== pdf.sha256) {
      throw new Error(`The stored copy of ${program.contractTitle} does not match what was uploaded.`);
    }
    const created = await pool.query(
      `INSERT INTO participant_contracts (title, storage_ref, pdf_sha256, created_by) VALUES ($1, $2, $3, NULL) RETURNING id`,
      [program.contractTitle, reference, pdf.sha256]
    );
    return { id: Number(created.rows[0].id), storedAs: reference };
  } catch (error) {
    await removeStoredMedia(reference).catch(() => undefined);
    throw error;
  }
}

/** PUT /admin/contracts/offers/:id/requirements, keeping any boxes or benefits she has saved. */
async function saveRequirements(program, offer, contractId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO offer_checkout_requirements
         (offer_id, invitation_required, program_term, term_months, included_benefits,
          refund_terms, refund_window_days, obligations_note, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,now())
       ON CONFLICT (offer_id) DO UPDATE SET
         invitation_required = EXCLUDED.invitation_required,
         program_term = EXCLUDED.program_term,
         term_months = EXCLUDED.term_months,
         included_benefits = CASE WHEN EXCLUDED.included_benefits = '' THEN offer_checkout_requirements.included_benefits ELSE EXCLUDED.included_benefits END,
         refund_terms = EXCLUDED.refund_terms,
         refund_window_days = EXCLUDED.refund_window_days,
         obligations_note = EXCLUDED.obligations_note,
         updated_at = now()`,
      [offer.id, program.invitationRequired, program.programTerm, program.termMonths, program.includedBenefits, program.refundTerms, program.refundWindowDays, program.obligationsNote]
    );
    await client.query(
      `INSERT INTO offer_contracts (offer_id, contract_id, created_by, required_before_payment)
       VALUES ($1, $2, NULL, true)
       ON CONFLICT (offer_id, contract_id) DO UPDATE SET required_before_payment = true`,
      [offer.id, contractId]
    );
    for (const [column, value] of Object.entries(program.offerChanges)) {
      if (column !== "allow_gifting" && column !== "recovery_enabled") throw new Error(`Unexpected offer column ${column}`);
      await client.query(`UPDATE offers SET ${column} = $2, updated_at = now() WHERE id = $1`, [offer.id, value]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function activate(key, file, pdf, args) {
  const program = PROGRAMS[key];
  const offer = await findOffer(program.slug);
  console.log(`\n=== ${offer.title} (offer ${offer.id}, ${offer.status}) ===`);
  console.log(`PDF ${path.basename(file)}: ${pdf.bytes.length} bytes, sha256 ${pdf.sha256}, document title "${pdf.title}"`);

  // The guards the admin route applies before saving.
  if (offer.status !== "published") throw new Error(`${offer.slug} is not published.`);
  if (offer.live_links > 0) throw new Error(`${offer.slug} has ${offer.live_links} live Stripe payment link(s), which would skip these steps. Deactivate them first.`);
  if (!program.programTerm || !program.refundTerms) throw new Error("Fill in the program term and the refund terms first.");

  const existing = await findContract(program, pdf.sha256);
  const current = await pool.query(`SELECT * FROM offer_checkout_requirements WHERE offer_id = $1`, [offer.id]);
  console.log(`Contract: ${existing ? `reuse ${existing.id} "${existing.title}"` : `create "${program.contractTitle}" at protected:contracts/<uuid>.pdf`}`);
  console.log(`Requirements row now: ${current.rows[0] ? JSON.stringify(current.rows[0]) : "none"}`);
  console.log("Requirements after:", JSON.stringify({ ...program, slug: undefined, contractTitle: undefined, offerChanges: undefined }, null, 2));
  for (const [column, value] of Object.entries(program.offerChanges)) console.log(`Offer ${column}: ${offer[column]} -> ${value}`);
  if (!program.includedBenefits) console.log("NOTE: included_benefits stays blank: the agreement states no session counts. Fill it in on the offer's Contracts tab before inviting anyone.");

  if (!args.apply) {
    console.log("Dry run: nothing changed. Add --apply to do this.");
    return;
  }
  const contract = existing ?? (await createContract(program, pdf));
  await saveRequirements(program, offer, contract.id);
  console.log(`DONE: contract ${contract.id} is required before payment on ${offer.slug}.`);
}

/** The offers had no requirements row or required link before this script. */
async function rollback(args) {
  const offers = await pool.query(`SELECT id, slug FROM offers WHERE slug = ANY($1::text[])`, [Object.values(PROGRAMS).map((program) => program.slug)]);
  const ids = offers.rows.map((row) => row.id);
  const boardroom = offers.rows.find((row) => row.slug === PROGRAMS.boardroom.slug);
  const statements = [
    [`DELETE FROM offer_contracts WHERE offer_id = ANY($1::int[]) AND required_before_payment`, [ids]],
    [`DELETE FROM offer_checkout_requirements WHERE offer_id = ANY($1::int[])`, [ids]],
    ...(boardroom ? [[`UPDATE offers SET allow_gifting = true, recovery_enabled = true, updated_at = now() WHERE id = $1`, [boardroom.id]]] : []),
  ];
  for (const [sql, values] of statements) console.log(`${args.apply ? "RUN" : "WOULD RUN"}: ${sql} -- ${JSON.stringify(values)}`);
  console.log("Signatures already taken and the participant_contracts rows stay: they are the record of what was signed.");
  if (!args.apply) {
    console.log("Dry run: nothing changed. Add --apply to do this.");
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [sql, values] of statements) await client.query(sql, values);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  console.log("DONE: requirements are off for The Club and The Boss Boardroom.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Media store: ${env.mediaStorage.store}. Mode: ${args.apply ? "APPLY" : "dry run"}.`);
  if (args.rollback) return rollback(args);
  const keys = Object.keys(args.files);
  if (keys.length === 0) throw new Error("Pass --club <pdf> and/or --boardroom <pdf>, or --rollback.");
  // The record's time zone and the cart guard ship in the release this belongs to.
  if (args.apply && typeof requirementsService.resolveBuyerTimeZone !== "function") {
    throw new Error("This container predates the release with time zones and the cart guard. Deploy it first.");
  }
  // Every file is checked before anything is written.
  const pdfs = keys.map((key) => loadPdf(PROGRAMS[key], args.files[key], args.approved));
  for (const [index, key] of keys.entries()) await activate(key, args.files[key], pdfs[index], args);
}

main()
  .catch((error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
