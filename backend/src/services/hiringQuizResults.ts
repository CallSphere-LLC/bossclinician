import { brandEmailHtml } from "../email/brandShell";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { renderMarkdown } from "../email/provider";
import { unsendableReason } from "./emailSendGuard";

const FORMS:Record<string,string>={"hiring-quiz-ready":"Ready","hiring-quiz-almost":"Almost Ready","hiring-quiz-not-yet":"Not Yet"};
export const isHiringResultForm=(slug:string):boolean=>Object.hasOwn(FORMS,slug);
/** Requested H0 is transactional; optional sales consent never withholds the result. */
export async function sendHiringQuizResults(input:{formSlug:string;email:string;contactId:number|null;submissionId:number}):Promise<boolean>{
 if(!isHiringResultForm(input.formSlug))return false;
 const suppressed=await pool.query("SELECT 1 FROM email_suppressions WHERE email=$1",[input.email]);
 if(suppressed.rows.length)return false;
 const counts=(await pool.query<{address:string;total:string}>(`SELECT count(*) FILTER(WHERE to_email=$1)::text AS address,count(*)::text AS total FROM email_messages WHERE topic='hiring_quiz_result' AND created_at>now()-interval '24 hours'`,[input.email])).rows[0];
 if(Number(counts?.address)>=5 || Number(counts?.total)>=500)return false;
 const row=(await pool.query<{config:{subject?:string;previewText?:string;bodyMd?:string}}>(`SELECT x.config FROM automation_actions x JOIN automations a ON a.id=x.automation_id JOIN forms f ON f.id::text=a.trigger_config->>'formId' WHERE f.slug=$1 AND a.name=$2 AND x.action_type='send_email' ORDER BY x.id LIMIT 1`,[input.formSlug,`Hiring quiz result email — ${FORMS[input.formSlug]}`])).rows[0];
 const config=row?.config;
 if(!config?.subject || !config.bodyMd || unsendableReason([config.subject,config.previewText,config.bodyMd],{},[config.subject,config.previewText,config.bodyMd]))return false;
 const sent=await sendMail({to:input.email,subject:config.subject,preheader:config.previewText,text:config.bodyMd,html:brandEmailHtml({html:renderMarkdown(config.bodyMd),text:config.bodyMd,subject:config.subject,preheader:config.previewText,siteUrl:env.publicSiteUrl,receiptReason:"You requested your hiring quiz results from"}),topic:"hiring_quiz_result",sourceId:input.submissionId,contactId:input.contactId});
 if(!sent.sent)throw new Error("Requested hiring result delivery failed; retry the claimed action");
 return true;
}

/** null means this is not one of the three requested-result actions. */
export async function sendHiringQuizAutomationResult(input:{automationId:number;formId:number|null;email:string;contactId:number;eventKey?:string}):Promise<boolean|null>{
 const row=(await pool.query<{slug:string}>(`SELECT f.slug FROM automations a JOIN forms f ON f.id::text=a.trigger_config->>'formId' WHERE a.id=$1 AND f.id=$2 AND a.name IN ('Hiring quiz result email — Ready','Hiring quiz result email — Almost Ready','Hiring quiz result email — Not Yet')`,[input.automationId,input.formId])).rows[0];
 if(!row || !isHiringResultForm(row.slug))return null;
 const submission=/^form-submitted:(\d+)$/.exec(input.eventKey??"");
 return sendHiringQuizResults({formSlug:row.slug,email:input.email,contactId:input.contactId,submissionId:submission?Number(submission[1]):input.automationId});
}

/** Requested legacy quiz result only, never the later sales emails. */
export async function sendRequestedLegacyQuizResult(input:{to:string;subject:string;text:string;html:string;preheader:string;contactId:number;sourceId:number}) {
 const blocked=(await pool.query("SELECT 1 FROM email_suppressions WHERE email=$1",[input.to])).rows[0];
 const count=(await pool.query<{n:string}>("SELECT count(*)::text n FROM email_messages WHERE to_email=$1 AND topic='legacy_quiz_result' AND created_at>now()-interval '24 hours'",[input.to])).rows[0];
 if(blocked || Number(count?.n)>=5)return {outcome:"suppressed" as const,suppressedReason:"Suppressed or requested-result daily cap",messageId:null,providerMessageId:""};
 const result=await sendMail({...input,html:brandEmailHtml({...input,siteUrl:env.publicSiteUrl,receiptReason:"You requested your quiz results from"}),topic:"legacy_quiz_result"});
 if(!result.sent)throw new Error("Requested quiz result delivery failed");
 return {outcome:"sent" as const,suppressedReason:"",messageId:result.messageId,providerMessageId:result.providerMessageId};
}
