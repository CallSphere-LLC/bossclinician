import { describe, expect, it } from 'vitest';
import { assessmentAttemptIsInScope } from './engineV2';

describe('assessment automation rollout boundary', () => {
  it('leaves existing automations and unrelated triggers unchanged', () => {
    expect(assessmentAttemptIsInScope('assessment_passed', {}, {})).toBe(true);
    expect(assessmentAttemptIsInScope('form_submitted', {minimumAttemptId: 10}, {})).toBe(true);
  });
  it('accepts the first and later new attempts', () => {
    expect(assessmentAttemptIsInScope('assessment_passed', {minimumAttemptId: 10}, {attemptId: 10})).toBe(true);
    expect(assessmentAttemptIsInScope('assessment_completed', {minimumAttemptId: 10}, {attemptId: 11})).toBe(true);
  });
  it.each([{}, {attemptId: 9}, {attemptId: null}, {attemptId: 'invalid'}, {attemptId: 10.5}])('rejects historical or malformed attempts %j', facts => {
    expect(assessmentAttemptIsInScope('assessment_passed', {minimumAttemptId: 10}, facts)).toBe(false);
  });
  it.each([0, -1, null, 'invalid', 1.5])('fails closed for invalid configured boundary %j', minimumAttemptId => {
    expect(assessmentAttemptIsInScope('assessment_passed', {minimumAttemptId}, {attemptId: 20})).toBe(false);
  });
});
