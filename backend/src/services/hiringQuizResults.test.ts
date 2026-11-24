import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),send:vi.fn()}));
vi.mock("../db/pool",()=>({pool:{query:mocks.query}}));
vi.mock("../email/mailer",()=>({sendMail:mocks.send}));
vi.mock("../email/provider",()=>({renderMarkdown:(body:string)=>`<p>${body}</p>`}));
import { sendHiringQuizResults } from "./hiringQuizResults";
const input={formSlug:"hiring-quiz-ready",email:"result@example.invalid",contactId:7,submissionId:8};
beforeEach(()=>{vi.clearAllMocks();mocks.send.mockResolvedValue({sent:true});});
describe("requested hiring results",()=>{
 it("sends exact H0 independently from marketing opt-in with branded mailer and preview",async()=>{
  mocks.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{address:"0",total:"0"}]}).mockResolvedValueOnce({rows:[{config:{subject:"Your result",previewText:"Next step",bodyMd:"Ready result"}}]});
  expect(await sendHiringQuizResults(input)).toBe(true);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({subject:"Your result",preheader:"Next step",text:"Ready result",topic:"hiring_quiz_result",sourceId:8}));
  expect(mocks.query.mock.calls.some(([sql])=>String(sql).includes("email_marketing_status"))).toBe(false);
 });
 it("never sends a suppressed address",async()=>{mocks.query.mockResolvedValueOnce({rows:[{}]});expect(await sendHiringQuizResults(input)).toBe(false);expect(mocks.send).not.toHaveBeenCalled();});
 it("caps repeated results instead of creating an email loop",async()=>{mocks.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{address:"5",total:"5"}]});expect(await sendHiringQuizResults(input)).toBe(false);expect(mocks.send).not.toHaveBeenCalled();});
 it("holds missing or unresolved result templates",async()=>{mocks.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{address:"0",total:"0"}]}).mockResolvedValueOnce({rows:[{config:{subject:"Result",bodyMd:"{{unknown}}"}}]});expect(await sendHiringQuizResults(input)).toBe(false);expect(mocks.send).not.toHaveBeenCalled();});
 it("does not send for other forms",async()=>{expect(await sendHiringQuizResults({...input,formSlug:"other"})).toBe(false);expect(mocks.query).not.toHaveBeenCalled();});
});
