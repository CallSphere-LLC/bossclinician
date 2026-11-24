import { describe, expect, it } from "vitest";
import { followupChoice, practiceStage } from "./quizFollowups";
import { renderedProblem } from "./emailSendGuard";

describe("quiz sales routing", () => {
 it("uses only an explicitly confirmed stage", () => {
   expect(practiceStage("not_launched")).toBe("not_launched");
   expect(practiceStage("first_hire")).toBe("first_hire");
   expect(practiceStage("existing_team")).toBe("existing_team");
   expect(practiceStage("Ready")).toBeNull();
   expect(practiceStage(undefined)).toBeNull();
 });
 it("keeps unknown stage under review rather than guessing from the score", () => {
   expect(followupChoice(null,"quiz-hiring-ready",true)).toBeNull();
 });
 it("routes first-hire owners to their hiring outcome even after both tools", () => {
   expect(followupChoice("first_hire","quiz-hiring-almost",true)).toBe("quiz-hiring-almost");
 });
 it("routes existing teams to assessment and waits when that tool is incomplete", () => {
   expect(followupChoice("existing_team","quiz-hiring-ready",false)).toBeNull();
   expect(followupChoice("existing_team","quiz-hiring-ready",true)).toBe("quiz-assessment-followup");
 });
 it("does not invent a Club free-training registration for an unlaunched practice", () => {
   expect(followupChoice("not_launched","quiz-hiring-not-yet",true)).toBeNull();
 });
 it("blocks an unresolved walkthrough even if an administrator enables its email", () => {
   expect(renderedProblem(["[Watch]([BOARDROOM_WALKTHROUGH_URL])"])).toContain("missing");
   expect(renderedProblem(["[Watch](https://www.bossclinician.com/boardroom)"])).toBe("");
 });
});
