import { describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),send:vi.fn()}));
vi.mock("../db/pool",()=>({pool:{query:mocks.query}}));
vi.mock("../email/mailer",()=>({sendMail:mocks.send}));
vi.mock("../email/provider",()=>({marketingSettings:async()=>({replyTo:"monitored@example.invalid"})}));
import { scoreBossAssessment, sendBossAssessmentResults } from "./bossAssessment";
describe("assessment requested-result reply address",()=>{
 it("uses the configured monitored reply-to without overriding the SMTP from",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{to_address:"0",total:"0"}]});mocks.send.mockResolvedValue({sent:true});
  expect(await sendBossAssessmentResults({email:"reader@example.invalid",firstName:"Reader",result:scoreBossAssessment(Array(10).fill(3)),submissionId:1,contactId:2})).toBe(true);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({replyTo:"monitored@example.invalid"}));
  expect(mocks.send.mock.calls[0][0].from).toBeUndefined();
 });
});
