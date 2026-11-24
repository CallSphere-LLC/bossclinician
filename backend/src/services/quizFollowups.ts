import { pool } from "../db/pool";

/** Old cached forms retain their prior contract during the backend-first handoff. */
export function hasExplicitHiringConsent(slug: string, raw: Record<string, unknown>): boolean {
  return (slug === "hire-form" || ["hiring-quiz-ready","hiring-quiz-almost","hiring-quiz-not-yet"].includes(slug)) && Object.hasOwn(raw,"marketing_consent");
}
export type PracticeStage = "not_launched" | "first_hire" | "existing_team";
export function practiceStage(value: unknown): PracticeStage | null {
  return value === "not_launched" || value === "first_hire" || value === "existing_team" ? value : null;
}
export function followupChoice(stage: PracticeStage | null, hiring: string | null, assessment: boolean): string | null {
  if (stage === "not_launched") return null; // Club requires its own real registration; never invent one.
  if (stage === "existing_team") return assessment ? "quiz-assessment-followup" : null;
  if (stage === "first_hire") return hiring;
  return null; // An unknown stage keeps the current sequence and is marked for review.
}

/** New submissions only. Results delivery is independent of marketing enrollment. */
export async function routeQuizFollowup(contactId: number, formSlug: string, raw: Record<string, unknown>, completedAt = new Date()): Promise<void> {
  const hiring = ({ "hiring-quiz-ready": "quiz-hiring-ready", "hiring-quiz-almost": "quiz-hiring-almost", "hiring-quiz-not-yet": "quiz-hiring-not-yet" } as Record<string, string>)[formSlug];
  const assessment = formSlug === "boss-assessment";
  if (!hiring && !assessment) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(236, $1)", [contactId]);
    const c = (await client.query<{email_marketing_status: string; custom_fields: Record<string, unknown>}>("SELECT email_marketing_status, custom_fields FROM contacts WHERE id=$1", [contactId])).rows[0];
    if (!c) { await client.query("COMMIT"); return; }
    const stage = practiceStage(raw.practice_stage) ?? practiceStage(c.custom_fields?.practice_stage);
    await client.query(`INSERT INTO quiz_followup_state(contact_id, practice_stage, hiring_slug, hiring_completed_at, assessment_completed_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(contact_id) DO UPDATE SET
      practice_stage=COALESCE(EXCLUDED.practice_stage,quiz_followup_state.practice_stage),
      hiring_slug=COALESCE(quiz_followup_state.hiring_slug,EXCLUDED.hiring_slug),
      hiring_completed_at=COALESCE(quiz_followup_state.hiring_completed_at,EXCLUDED.hiring_completed_at),
      assessment_completed_at=COALESCE(quiz_followup_state.assessment_completed_at,EXCLUDED.assessment_completed_at),updated_at=now()`,
      [contactId,stage,hiring ?? null,hiring ? completedAt : null,assessment ? completedAt : null]);
    const state = (await client.query<{practice_stage: PracticeStage|null; hiring_slug:string|null; hiring_completed_at:Date|null; assessment_completed_at:Date|null}>("SELECT * FROM quiz_followup_state WHERE contact_id=$1",[contactId])).rows[0];
    const slug = followupChoice(state.practice_stage,state.hiring_slug,!!state.assessment_completed_at);
    let review = !state.practice_stage ? "Confirm practice stage; retained current followup" : state.practice_stage === "not_launched" ? "Club funnel requires a separate free-training registration" : !slug ? "Waiting for the quiz appropriate to the confirmed practice stage" : null;
    if (c.email_marketing_status !== "subscribed") review = "Marketing consent absent or suppressed; results only";
    await client.query("UPDATE quiz_followup_state SET review_reason=$2 WHERE contact_id=$1",[contactId,review]);
    // A confirmed incompatible stage stops old sales mail even when the next quiz/registration is missing.
    if (state.practice_stage && !slug) await client.query(`UPDATE sequence_subscriptions s SET status='exited',next_send_at=NULL,exit_reason='Confirmed practice stage no longer matches',updated_at=now() FROM email_sequences q WHERE q.id=s.sequence_id AND q.completion_anchored AND s.contact_id=$1 AND s.status IN ('active','paused')`,[contactId]);
    await client.query("UPDATE contacts SET custom_fields=custom_fields || jsonb_build_object('quiz_followup_review',$2::text),updated_at=now() WHERE id=$1",[contactId,review ?? ""]);
    if (!slug || c.email_marketing_status !== "subscribed") { await client.query("COMMIT"); return; }
    const q = (await client.query<{id:number}>("SELECT id FROM email_sequences WHERE slug=$1 AND status='active'",[slug])).rows[0];
    if (!q) { await client.query("COMMIT"); return; }
    // A completed run never restarts on repeated form submission or a new browser.
    const existing=(await client.query("SELECT id FROM sequence_subscriptions WHERE sequence_id=$1 AND contact_id=$2",[q.id,contactId])).rows[0];
    if (existing) { await client.query("COMMIT"); return; }
    await client.query(`UPDATE sequence_subscriptions s SET status='exited',exit_reason='Practice-stage routing to another sales sequence',next_send_at=NULL,updated_at=now()
      FROM email_sequences q WHERE q.id=s.sequence_id AND q.sales_family IS NOT NULL AND s.position>=q.sales_start_position AND s.contact_id=$1 AND s.status IN ('active','paused')`,[contactId]);
    const anchor = slug === "quiz-assessment-followup" ? state.assessment_completed_at! : state.hiring_completed_at!;
    await client.query(`INSERT INTO sequence_subscriptions(sequence_id,contact_id,status,position,next_send_at,entered_at)
      SELECT $1,$2,'active',position,$3::timestamptz + delay_minutes * interval '1 minute',$3
      FROM sequence_emails WHERE sequence_id=$1 AND enabled ORDER BY position LIMIT 1
      ON CONFLICT(sequence_id,contact_id) DO NOTHING`,[q.id,contactId,anchor]);
    await client.query("UPDATE quiz_followup_state SET active_sequence_id=$2 WHERE contact_id=$1",[contactId,q.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
