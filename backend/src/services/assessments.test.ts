import { describe, expect, it } from "vitest";
import {
  bandFor,
  scoreResponses,
  type AssessmentDefinition,
  type QuestionDefinition,
  type ResultBand,
} from "./assessments";

/* The live offer quiz in miniature: three weighted questions, four archetypes. */

function question(
  id: number,
  weights: number[],
  overrides: Partial<QuestionDefinition> = {}
): QuestionDefinition {
  return {
    id,
    kind: "single",
    required: true,
    answers: weights.map((weight, index) => ({
      id: id * 100 + index,
      weight,
      isCorrect: false,
      feedback: "",
    })),
    ...overrides,
  };
}

const ARCHETYPES: ResultBand[] = [
  { id: 1, position: 0, minScore: 0, maxScore: 7 },
  { id: 2, position: 1, minScore: 8, maxScore: 14 },
  { id: 3, position: 2, minScore: 15, maxScore: 21 },
  { id: 4, position: 3, minScore: 22, maxScore: 2147483647 },
];

const QUIZ: AssessmentDefinition = {
  id: 1,
  kind: "quiz",
  passMark: null,
  questions: [question(1, [1, 5, 9]), question(2, [1, 5, 9]), question(3, [1, 5, 9])],
  results: ARCHETYPES,
};

describe("scoreResponses — a weighted quiz", () => {
  it("sums the weights of the chosen answers", () => {
    const scored = scoreResponses(QUIZ, [
      { questionId: 1, answerIds: [101] },
      { questionId: 2, answerIds: [201] },
      { questionId: 3, answerIds: [302] },
    ]);
    expect(scored.score).toBe(5 + 5 + 9);
    expect(scored.maxScore).toBe(27);
    expect(scored.percent).toBe(70);
  });

  it("routes each band to its own result", () => {
    const lowest = scoreResponses(QUIZ, [
      { questionId: 1, answerIds: [100] },
      { questionId: 2, answerIds: [200] },
      { questionId: 3, answerIds: [300] },
    ]);
    expect(lowest.score).toBe(3);
    expect(lowest.resultId).toBe(1);

    const highest = scoreResponses(QUIZ, [
      { questionId: 1, answerIds: [102] },
      { questionId: 2, answerIds: [202] },
      { questionId: 3, answerIds: [302] },
    ]);
    expect(highest.score).toBe(27);
    expect(highest.resultId).toBe(4);
  });

  it("does not let a single-choice question be answered with every option", () => {
    // The submission is a POST the visitor controls. Counting all three would
    // score 15 and jump two archetypes.
    const scored = scoreResponses(QUIZ, [{ questionId: 1, answerIds: [100, 101, 102] }]);
    expect(scored.score).toBe(1);
  });

  it("counts every selection on a multiple-choice question", () => {
    const definition: AssessmentDefinition = {
      ...QUIZ,
      questions: [question(1, [2, 3, 4], { kind: "multiple" })],
    };
    const scored = scoreResponses(definition, [{ questionId: 1, answerIds: [100, 102] }]);
    expect(scored.score).toBe(6);
    // Everything positive is available on a multiple, so the max is the sum.
    expect(scored.maxScore).toBe(9);
  });

  it("ignores answers that belong to another question", () => {
    const scored = scoreResponses(QUIZ, [{ questionId: 1, answerIds: [202] }]);
    expect(scored.score).toBe(0);
  });

  it("ignores a question that no longer exists", () => {
    const scored = scoreResponses(QUIZ, [{ questionId: 99, answerIds: [1] }]);
    expect(scored.score).toBe(0);
  });

  it("reports the required questions left blank without refusing to score", () => {
    const scored = scoreResponses(QUIZ, [{ questionId: 1, answerIds: [100] }]);
    expect(scored.missingQuestionIds).toEqual([2, 3]);
    expect(scored.score).toBe(1);
  });

  it("never reports a pass or a fail", () => {
    expect(scoreResponses(QUIZ, []).passed).toBeNull();
  });

  it("survives a quiz with no scorable questions", () => {
    const definition: AssessmentDefinition = { ...QUIZ, questions: [], results: [] };
    const scored = scoreResponses(definition, []);
    expect(scored.maxScore).toBe(0);
    expect(scored.percent).toBe(0);
    expect(scored.resultId).toBeNull();
  });

  it("scores a free-text question as nothing, but notices it is blank", () => {
    const definition: AssessmentDefinition = {
      ...QUIZ,
      questions: [{ id: 5, kind: "text", required: true, answers: [] }],
    };
    expect(scoreResponses(definition, []).missingQuestionIds).toEqual([5]);
    expect(
      scoreResponses(definition, [{ questionId: 5, text: "  " }]).missingQuestionIds
    ).toEqual([5]);
    expect(
      scoreResponses(definition, [{ questionId: 5, text: "Solo practice" }]).missingQuestionIds
    ).toEqual([]);
  });

  it("clamps a percentage that negative weights would push below zero", () => {
    const definition: AssessmentDefinition = {
      ...QUIZ,
      questions: [question(1, [-5, 0, 3])],
    };
    const scored = scoreResponses(definition, [{ questionId: 1, answerIds: [100] }]);
    expect(scored.score).toBe(-5);
    expect(scored.percent).toBe(0);
  });
});

describe("bandFor", () => {
  it("takes the first match in position order when bands overlap", () => {
    const overlapping: ResultBand[] = [
      { id: 20, position: 1, minScore: 8, maxScore: 20 },
      { id: 10, position: 0, minScore: 0, maxScore: 10 },
    ];
    // 9 is in both. The editor's ordering decides, not the database's.
    expect(bandFor(9, overlapping)).toBe(10);
  });

  it("breaks a position tie on id, so the answer is stable", () => {
    const tied: ResultBand[] = [
      { id: 7, position: 0, minScore: 0, maxScore: 100 },
      { id: 3, position: 0, minScore: 0, maxScore: 100 },
    ];
    expect(bandFor(50, tied)).toBe(3);
  });

  it("returns nothing for a score above every band", () => {
    const bands: ResultBand[] = [{ id: 1, position: 0, minScore: 0, maxScore: 10 }];
    // Not clamped into the top band: a quiz whose bands stop at 10 while its
    // questions total 27 is misconfigured, and hiding that assigns hundreds of
    // people an archetype nobody chose.
    expect(bandFor(11, bands)).toBeNull();
  });

  it("returns nothing when no results are configured at all", () => {
    expect(bandFor(0, [])).toBeNull();
  });

  it("returns nothing for a score below every band", () => {
    expect(bandFor(-1, [{ id: 1, position: 0, minScore: 0, maxScore: 10 }])).toBeNull();
  });
});

/* ------------------------------------------------------------ graded tests */

const GRADED: AssessmentDefinition = {
  id: 2,
  kind: "graded",
  passMark: 70,
  questions: [
    {
      id: 1,
      kind: "single",
      required: true,
      answers: [
        { id: 11, weight: 0, isCorrect: true, feedback: "That's the one." },
        { id: 12, weight: 0, isCorrect: false, feedback: "Not quite." },
      ],
    },
    {
      id: 2,
      kind: "multiple",
      required: true,
      answers: [
        { id: 21, weight: 0, isCorrect: true, feedback: "" },
        { id: 22, weight: 0, isCorrect: true, feedback: "" },
        { id: 23, weight: 0, isCorrect: false, feedback: "" },
      ],
    },
    {
      id: 3,
      kind: "single",
      required: true,
      answers: [
        { id: 31, weight: 0, isCorrect: true, feedback: "" },
        { id: 32, weight: 0, isCorrect: false, feedback: "" },
      ],
    },
  ],
  results: [],
};

describe("scoreResponses — a graded test", () => {
  it("marks one point per fully correct question", () => {
    const scored = scoreResponses(GRADED, [
      { questionId: 1, answerIds: [11] },
      { questionId: 2, answerIds: [21, 22] },
      { questionId: 3, answerIds: [32] },
    ]);
    expect(scored.score).toBe(2);
    expect(scored.maxScore).toBe(3);
    expect(scored.percent).toBe(67);
    expect(scored.passed).toBe(false);
  });

  it("does not award a partially correct multiple choice", () => {
    const scored = scoreResponses(GRADED, [{ questionId: 2, answerIds: [21] }]);
    expect(scored.score).toBe(0);
  });

  it("does not award the right answer plus a wrong one", () => {
    const scored = scoreResponses(GRADED, [{ questionId: 2, answerIds: [21, 22, 23] }]);
    expect(scored.score).toBe(0);
  });

  it("passes at exactly the pass mark", () => {
    const scored = scoreResponses(
      { ...GRADED, passMark: 67 },
      [
        { questionId: 1, answerIds: [11] },
        { questionId: 2, answerIds: [21, 22] },
        { questionId: 3, answerIds: [32] },
      ]
    );
    expect(scored.passed).toBe(true);
  });

  it("returns the feedback for the answer that was given", () => {
    const scored = scoreResponses(GRADED, [{ questionId: 1, answerIds: [12] }]);
    expect(scored.feedback).toEqual([{ questionId: 1, correct: false, text: "Not quite." }]);
  });
});
