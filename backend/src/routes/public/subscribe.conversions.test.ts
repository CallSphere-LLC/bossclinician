import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const mocks = vi.hoisted(() => ({ accepted: vi.fn(), save: vi.fn(), send: vi.fn() }));
vi.mock("../../db/pool", () => ({ pool: {} }));
vi.mock("../../services/funnelSubscriptions", () => ({ saveAcceptedSubscription: mocks.save }));
vi.mock("../../email/sesValidation", () => ({ validateCollectedEmail: mocks.accepted }));
vi.mock("../../email/mailer", () => ({ sendMail: mocks.send }));
vi.mock("../../email/templates", () => ({ subscriberWelcome: () => ({ subject: "test", text: "test", html: "test" }) }));
vi.mock("../../middleware/rateLimit", () => ({ subscribeLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../automations/engine", () => ({ fireTriggerAsync: vi.fn() }));
vi.mock("../../services/domainEvents", () => ({ publishDomainEvent: vi.fn() }));
vi.mock("../../services/ownerOptInNotification", () => ({ notifyOwnerOfOptIn: vi.fn() }));
vi.mock("../../services/sequences", () => ({ enrollContact: vi.fn() }));
vi.mock("../../services/contacts", () => ({ applyTags: vi.fn(), linkContact: vi.fn(), recordActivity: vi.fn(), upsertContactWithStatus: vi.fn().mockResolvedValue({ id: 1, created: false }) }));
import { subscribeRouter } from "./subscribe";

describe("accepted subscription conversion boundary", () => {
 let server: Server; let base: string;
 beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(subscribeRouter);
  app.use((error: {status?: number}, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status ?? 500).json({ok:false}); });
  server = await new Promise<Server>((resolve) => { const s=app.listen(0,"127.0.0.1",()=>resolve(s)); });
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 });
 afterAll(async () => { await new Promise<void>((resolve,reject)=>server.close((error)=>error?reject(error):resolve())); });
 beforeEach(() => { vi.clearAllMocks(); mocks.accepted.mockResolvedValue({accepted:true}); mocks.save.mockResolvedValue({id:1,prior_source:"footer"}); });
 const post=(body:unknown)=>fetch(`${base}/subscribe`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 it("never records a rejected spam address or sends its email", async()=>{
  mocks.accepted.mockResolvedValue({accepted:false,reason:"Blocked"});
  expect((await post({email:"blocked@example.com",source:"funnel:test",funnelStepId:9})).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
 });
 it("rejects invalid step identifiers before saving",async()=>{
  expect((await post({email:"test@example.com",source:"footer",funnelStepId:-1})).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
 });
 it("does not send welcome email after a rejected or rolled-back save",async()=>{
  mocks.save.mockRejectedValueOnce(Object.assign(new Error("Invalid funnel"), {status:400}));
  expect((await post({email:"test@example.com",source:"funnel:wrong",funnelStepId:9})).status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();
 });
 it("keeps subscriptions without funnel attribution compatible",async()=>{
  expect((await post({email:"test@example.com",source:"footer"})).status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith({}, {email:"test@example.com",source:"footer",funnelStepId:undefined});
 });
});
