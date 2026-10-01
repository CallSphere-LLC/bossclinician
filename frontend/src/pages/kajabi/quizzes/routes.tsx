import type { JSX } from "react";
import BossAssessment from "./BossAssessment";
import HireForm from "./HireForm";
import HiringQuiz from "./HiringQuiz";
import OfferQuiz from "./OfferQuiz";
import PracticeQuizThankYou from "./PracticeQuizThankYou";
import { CarefulForm, ReluctantForm, SteadyForm, VisionaryForm } from "./PracticeResultForm";
import RetreatNeededQuiz from "./RetreatNeededQuiz";
import RetreatThankYou from "./RetreatThankYou";

/**
 * The rebuilt Kajabi quizzes and their form / thank-you pages, at the same
 * addresses they had on bossclinician.com. Migration 099 deletes the redirect
 * rows that used to send these paths to /practice-quiz or /retreats.
 *
 * Eager imports on purpose: an `element` built from `React.lazy` suspends on
 * the server render unless something preloads it first, and only routes in
 * App's PUBLIC_ROUTES are preloaded. For code splitting, splice
 * `quizRouteTable` (./routeTable.ts, `lazyRoute` components) into
 * PUBLIC_ROUTES instead of using this list.
 */
export const quizRoutes: { path: string; element: JSX.Element }[] = [
  { path: "/offer-quiz", element: <OfferQuiz /> },
  { path: "/hiring-quiz", element: <HiringQuiz /> },
  { path: "/hire-form", element: <HireForm /> },
  { path: "/retreat-needed-quiz", element: <RetreatNeededQuiz /> },
  { path: "/retreat-thank-you-page", element: <RetreatThankYou /> },
  { path: "/boss-assessment", element: <BossAssessment /> },
  { path: "/visionary-form", element: <VisionaryForm /> },
  { path: "/careful-form", element: <CarefulForm /> },
  { path: "/steady-form", element: <SteadyForm /> },
  { path: "/reluctant-form", element: <ReluctantForm /> },
  { path: "/practice-set-up-quiz-ty", element: <PracticeQuizThankYou /> },
];
