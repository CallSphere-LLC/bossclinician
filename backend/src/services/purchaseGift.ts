import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { issueSetPasswordLink } from "./setPasswordLink";
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export async function deliverGift(order: {
  id: number; gift_member_id: number | null; gift_recipient_email: string;
  gift_message: string; gift_created_member: boolean; offer_title: string | null; billing_name: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query(`SELECT gift_delivered_at FROM orders WHERE id = $1 FOR UPDATE`, [order.id]);
    if (lock.rows[0]?.gift_delivered_at) { await client.query("COMMIT"); return; }
    const startUrl = `${env.publicSiteUrl}/library`;
    const password = order.gift_created_member && order.gift_member_id
      ? (await issueSetPasswordLink(order.gift_member_id))?.url : null;
    const title = order.offer_title || "a new product";
    const sender = order.billing_name || "Someone";
    const url = password || startUrl;
    const delivery = await sendMail({ topic: "purchase_gift", sourceId: order.id, memberId: order.gift_member_id,
      to: order.gift_recipient_email, subject: `${sender} sent you ${title}`,
      text: `${sender} sent you ${title}.\n\n${order.gift_message}\n\nOpen your gift: ${url}\nYou can return to your library to access it again.`,
      html: `<p>${escape(sender)} sent you <strong>${escape(title)}</strong>.</p>${order.gift_message ? `<p style="white-space:pre-wrap">${escape(order.gift_message)}</p>` : ""}<p><a href="${escape(url)}">Open your gift</a></p><p>You can return to your library to access it again.</p>`,
    });
    if (!delivery.sent) throw new Error(delivery.error || "Gift email was not sent");
    await client.query(`UPDATE orders SET gift_delivered_at = now() WHERE id = $1`, [order.id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function deliverGiftById(orderId: number): Promise<void> {
  const result = await pool.query(`SELECT o.id, o.gift_member_id, o.gift_recipient_email,
    o.gift_message, o.gift_created_member, o.billing_name, f.title AS offer_title
    FROM orders o LEFT JOIN offers f ON f.id = o.offer_id
    WHERE o.id = $1 AND o.status = 'paid' AND o.gift_recipient_email <> ''`, [orderId]);
  if (result.rows[0]) await deliverGift(result.rows[0]);
}
