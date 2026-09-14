import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * Lane G, end to end against a real database: a ZZ test form with a
 * conditional question and a file question, driven through the admin API that
 * builds it and the public endpoint strangers send it through.
 *
 * G1: a hidden question is not required and nothing sent for it is stored.
 * G2: a file is sniffed by its bytes, capped while it streams, stored in the
 * protected root with a random name, linked to the contact, and reachable only
 * through a signed admin link — and nothing is left behind when it's refused.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512, 7),
]);

const SLUG = "zz-lane-g-upload-check";

describeDb("public form conditions and file uploads (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: Server;
  let baseUrl: string;
  let storage: string;
  let publicDir: string;
  let protectedDir: string;
  let formId: number;

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  function partsLeft(): string[] {
    const parts = path.join(protectedDir, ".parts");
    return fs.existsSync(parts) ? fs.readdirSync(parts) : [];
  }

  function storedFiles(): string[] {
    return fs.readdirSync(protectedDir).filter((name) => name !== ".parts");
  }

  async function assetCount(): Promise<number> {
    const result = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM media_assets`);
    return result.rows[0].count;
  }

  function multipart(data: Record<string, unknown>, files: Record<string, { bytes: Buffer; name: string; type: string }>) {
    const body = new FormData();
    body.append("payload", JSON.stringify({ data, email: data.email }));
    for (const [key, file] of Object.entries(files)) {
      body.append(key, new Blob([file.bytes], { type: file.type }), file.name);
    }
    return fetch(`${baseUrl}/api/forms/${SLUG}/submit`, { method: "POST", body });
  }

  function json(data: Record<string, unknown>) {
    return fetch(`${baseUrl}/api/forms/${SLUG}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, email: data.email }),
    });
  }

  beforeAll(async () => {
    db = await createTestDatabase("formuploads");
    client = db.client;

    storage = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forms-"));
    publicDir = path.join(storage, "public");
    protectedDir = path.join(storage, "protected");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.UPLOAD_DIR = publicDir;
    process.env.PROTECTED_UPLOAD_DIR = protectedDir;
    fs.mkdirSync(publicDir, { recursive: true });
    fs.mkdirSync(protectedDir, { recursive: true });

    await client.query(
      `INSERT INTO admin_users (id, email, password_hash, name, role)
       VALUES (1, 'zz-lane-g@bossclinician.test', 'not-used-in-route-tests', 'ZZ Lane G', 'owner')`,
    );

    const [{ growthPublicRouter }, { verifyRouter }, { adminFormsRouter }, { errorHandler }] =
      await Promise.all([
        import("./growthPublic"),
        import("./verify"),
        import("../admin/formsV2"),
        import("../../middleware/errorHandler"),
      ]);

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json({ limit: "2mb" }));
    // The public mount, so the test can prove a form upload is NOT on it.
    app.use("/uploads", express.static(publicDir, { dotfiles: "deny" }));
    app.use("/api", growthPublicRouter);
    app.use("/api", verifyRouter);
    app.use(
      "/api/admin/forms-v2",
      (req, _res, next) => {
        req.user = { sub: 1, email: "zz-lane-g@bossclinician.test", role: "owner" };
        next();
      },
      adminFormsRouter,
    );
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const created = await fetch(`${baseUrl}/api/admin/forms-v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ZZ Lane G upload check",
        fields: [
          { key: "name", label: "Your name", type: "text", required: true },
          { key: "email", label: "Email address", type: "email", required: true, contactField: "email" },
          { key: "has_license", label: "Are you licensed?", type: "radio", options: ["Yes", "No"], required: true },
          {
            key: "license_number",
            label: "License number",
            type: "text",
            required: true,
            pattern: "^[0-9]+$",
            showIf: { field: "has_license", operator: "equals", value: "Yes" },
          },
          {
            key: "license_file",
            label: "Upload your license",
            type: "file",
            required: true,
            fileTypes: ["image", "pdf"],
            maxSizeMb: 1,
            showIf: { field: "has_license", operator: "equals", value: "Yes" },
          },
          {
            key: "why_not",
            label: "Why not?",
            type: "textarea",
            showIf: { field: "has_license", operator: "equals", value: "No" },
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const form = (await created.json()) as { id: number; slug: string };
    expect(form.slug).toBe(SLUG);
    formId = form.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------ builder */

  it("refuses to save a rule that names a question below it", async () => {
    const res = await fetch(`${baseUrl}/api/admin/forms-v2/${formId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: [
          { key: "a", label: "First", type: "text", showIf: { field: "b", operator: "answered" } },
          { key: "b", label: "Second", type: "text" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/which comes after it/);
  });

  it("refuses a file limit over the 10 MB hard cap", async () => {
    const res = await fetch(`${baseUrl}/api/admin/forms-v2/${formId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: [{ key: "cv", label: "CV", type: "file", maxSizeMb: 25 }] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("“CV” can take files up to 10 MB at most.");
  });

  /* ------------------------------------------------- G1 conditional logic */

  it("does not require a hidden question, and stores nothing sent for one", async () => {
    const res = await json({
      name: "ZZ Hidden Check",
      email: "success+zz-g-hidden@simulator.amazonses.com",
      has_license: "No",
      why_not: "Still in school",
      license_number: "not-even-a-number",
      license_file: { file: true, mediaAssetId: 1 },
    });
    expect(res.status).toBe(201);

    const stored = await client.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM form_submissions WHERE email = 'success+zz-g-hidden@simulator.amazonses.com'`,
    );
    expect(stored.rows[0].data).toEqual({
      name: "ZZ Hidden Check",
      email: "success+zz-g-hidden@simulator.amazonses.com",
      has_license: "No",
      why_not: "Still in school",
    });
  });

  it("requires a shown question, and says which one", async () => {
    const res = await json({ name: "ZZ Shown", email: "success+zz-g-shown@simulator.amazonses.com", has_license: "Yes" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Please answer “License number” — it's required.",
    );
  });

  it("checks the More rules on a shown question on the server too", async () => {
    const res = await json({
      name: "ZZ Rules",
      email: "success+zz-g-rules@simulator.amazonses.com",
      has_license: "Yes",
      license_number: "12AB",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("“License number” can only contain numbers.");
  });

  it("does not take a JSON claim of a file as a file", async () => {
    const res = await json({
      name: "ZZ Claim",
      email: "success+zz-g-claim@simulator.amazonses.com",
      has_license: "Yes",
      license_number: "12345",
      license_file: { file: true, mediaAssetId: 1, name: "someone-elses.pdf" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Please attach a file for “Upload your license”.");
  });

  /* ---------------------------------------------------- G2 file uploads */

  it("keeps a real file in the protected root, against the contact it created", async () => {
    const res = await multipart(
      { name: "ZZ Upload", email: "success+zz-g-upload@simulator.amazonses.com", has_license: "Yes", license_number: "12345" },
      // The declared type and the name both lie; the bytes are a PNG.
      { license_file: { bytes: PNG, name: "My\u202ELicense.html", type: "text/html" } },
    );
    expect(res.status).toBe(201);
    await settle();

    const contact = await client.query<{ id: number; custom_fields: Record<string, unknown> }>(
      `SELECT id, custom_fields FROM contacts WHERE email = 'success+zz-g-upload@simulator.amazonses.com'`,
    );
    expect(contact.rowCount).toBe(1);

    const asset = await client.query<{
      id: number;
      filename: string;
      url: string;
      mime: string;
      title: string;
      folder: string;
      contact_id: number;
      form_submission_id: number;
      form_field_key: string;
      size_bytes: string;
    }>(`SELECT * FROM media_assets WHERE contact_id = $1`, [contact.rows[0].id]);
    expect(asset.rowCount).toBe(1);
    const row = asset.rows[0];
    expect(row.url).toBe(`protected:${row.filename}`);
    expect(row.filename).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(row.mime).toBe("image/png");
    expect(row.title).toBe("MyLicense.png");
    expect(row.folder).toBe("Form uploads");
    expect(row.form_field_key).toBe("license_file");
    expect(Number(row.size_bytes)).toBe(PNG.length);

    const submission = await client.query<{ id: number; data: Record<string, { mediaAssetId?: number }> }>(
      `SELECT id, data FROM form_submissions WHERE email = 'success+zz-g-upload@simulator.amazonses.com'`,
    );
    expect(submission.rows[0].id).toBe(row.form_submission_id);
    expect(submission.rows[0].data.license_file?.mediaAssetId).toBe(row.id);

    // On disk in the protected root only, and not reachable at /uploads.
    expect(fs.readFileSync(path.join(protectedDir, row.filename)).equals(PNG)).toBe(true);
    expect(fs.existsSync(path.join(publicDir, row.filename))).toBe(false);
    expect((await fetch(`${baseUrl}/uploads/${row.filename}`)).status).toBe(404);
    expect(partsLeft()).toEqual([]);
    // Not smuggled into a contact detail either.
    expect(JSON.stringify(contact.rows[0].custom_fields ?? {})).not.toContain("license");
  });

  it("opens the file from the contact and the replies only through a signed admin link", async () => {
    const contact = await client.query<{ id: number }>(
      `SELECT id FROM contacts WHERE email = 'success+zz-g-upload@simulator.amazonses.com'`,
    );
    const list = await fetch(`${baseUrl}/api/admin/forms-v2/contacts/${contact.rows[0].id}/files`);
    expect(list.status).toBe(200);
    const files = (await list.json()) as { name: string; previewUrl: string; formName: string }[];
    expect(files).toHaveLength(1);
    expect(files[0].formName).toBe("ZZ Lane G upload check");
    expect(files[0].previewUrl.startsWith("/api/admin-files/")).toBe(true);

    const opened = await fetch(`${baseUrl}${files[0].previewUrl}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await opened.arrayBuffer()).equals(PNG)).toBe(true);

    const tampered = files[0].previewUrl.slice(0, -2) + (files[0].previewUrl.endsWith("A") ? "BB" : "AA");
    expect((await fetch(`${baseUrl}${tampered}`)).status).toBe(404);

    const replies = await fetch(`${baseUrl}/api/admin/forms-v2/${formId}/submissions`);
    const body = (await replies.json()) as { submissions: { email: string; files: { fieldKey: string }[] }[] };
    const withFile = body.submissions.find((reply) => reply.email === "success+zz-g-upload@simulator.amazonses.com");
    expect(withFile?.files.map((file) => file.fieldKey)).toEqual(["license_file"]);
  });

  it("refuses markup named and declared as a photo, and leaves nothing behind", async () => {
    const before = { assets: await assetCount(), files: storedFiles().length };
    const res = await multipart(
      { name: "ZZ Markup", email: "success+zz-g-markup@simulator.amazonses.com", has_license: "Yes", license_number: "12345" },
      { license_file: { bytes: Buffer.from("<html><script>alert(1)</script></html>".repeat(4)), name: "photo.png", type: "image/png" } },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/takes a photo .* or a PDF\. That file isn't one\./);
    await settle();
    expect(await assetCount()).toBe(before.assets);
    expect(storedFiles()).toHaveLength(before.files);
    expect(partsLeft()).toEqual([]);
    const submission = await client.query(`SELECT 1 FROM form_submissions WHERE email = 'success+zz-g-markup@simulator.amazonses.com'`);
    expect(submission.rowCount).toBe(0);
  });

  it("refuses a file over the question's limit while it streams", async () => {
    const before = { assets: await assetCount(), files: storedFiles().length };
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10, 1)]);
    const res = await multipart(
      { name: "ZZ Big", email: "success+zz-g-big@simulator.amazonses.com", has_license: "Yes", license_number: "12345" },
      { license_file: { bytes: big, name: "big.png", type: "image/png" } },
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe(
      "“Upload your license” takes files up to 1 MB. That one is bigger.",
    );
    await settle();
    expect(await assetCount()).toBe(before.assets);
    expect(storedFiles()).toHaveLength(before.files);
    expect(partsLeft()).toEqual([]);
  });

  it("throws away a file sent for a hidden question", async () => {
    const before = { assets: await assetCount(), files: storedFiles().length };
    const res = await multipart(
      { name: "ZZ Hidden File", email: "success+zz-g-hidden-file@simulator.amazonses.com", has_license: "No" },
      { license_file: { bytes: PNG, name: "license.png", type: "image/png" } },
    );
    expect(res.status).toBe(201);
    await settle();
    expect(await assetCount()).toBe(before.assets);
    expect(storedFiles()).toHaveLength(before.files);
    expect(partsLeft()).toEqual([]);
    const stored = await client.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM form_submissions WHERE email = 'success+zz-g-hidden-file@simulator.amazonses.com'`,
    );
    expect(stored.rows[0].data).not.toHaveProperty("license_file");
  });

  it("refuses a file for a question the form doesn't ask", async () => {
    const res = await multipart(
      { name: "ZZ Stray", email: "success+zz-g-stray@simulator.amazonses.com", has_license: "No" },
      { why_not: { bytes: PNG, name: "stray.png", type: "image/png" } },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("This form got a file it didn't ask for.");
    await settle();
    expect(partsLeft()).toEqual([]);
  });

  it("limits how many replies with files one address can send in an hour", async () => {
    // Every multipart reply counts, accepted or not; five were sent above.
    let status = 0;
    let message = "";
    for (let attempt = 0; attempt < 20 && status !== 429; attempt += 1) {
      const res = await multipart(
        { name: "ZZ Flood", email: `success+zz-g-flood-${attempt}@simulator.amazonses.com`, has_license: "No" },
        {},
      );
      status = res.status;
      if (status === 429) message = ((await res.json()) as { error: string }).error;
      else await res.arrayBuffer();
    }
    expect(status).toBe(429);
    expect(message).toMatch(/a lot of files/);
  });
});
