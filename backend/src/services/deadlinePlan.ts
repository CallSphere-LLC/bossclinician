import { addInterval } from "./pricing";

/** Monthly anniversaries, including month-end clamping, all on/before the
 * promised payoff date. The final installment absorbs integer-cent rounding. */
export function deadlinePlan(totalCents: number, depositCents: number, dueBy: string, enrolledAt: Date) {
  if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(depositCents) || depositCents <= 0 || totalCents <= depositCents) throw new Error("Invalid deposit plan amounts");
  const deadline = new Date(dueBy.slice(0,10) + "T23:59:59.999Z");
  if (!Number.isFinite(deadline.getTime()) || !Number.isFinite(enrolledAt.getTime())) throw new Error("Invalid plan date");
  const dates: Date[] = [];
  for (let n=1;n<=120;n++) {
    const next = addInterval(enrolledAt,"month",n);
    if (next > deadline) break;
    dates.push(next);
  }
  if (!dates.length) throw new Error("The payment-plan enrollment window has closed");
  const regular = Math.floor((totalCents-depositCents)/dates.length);
  const final = totalCents-depositCents-regular*(dates.length-1);
  return {amountCents:regular, finalInstallmentCents:final, installmentCount:dates.length+1,
    schedule:[{amountCents:depositCents,dueAt:enrolledAt.toISOString()}, ...dates.map((d,i)=>({amountCents:i===dates.length-1?final:regular,dueAt:d.toISOString()}))]};
}
