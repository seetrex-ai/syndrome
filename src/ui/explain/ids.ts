// The in-context explanations (tasks/plans/phase2.md D13). Each id is a branch
// `explain.<id>.{title, body}` of src/locales/*.json; tests/intent/explanations
// fails when an id lacks a text in a language or a text lacks an id, and lists
// which bodies are measured as predicates on the core (never checked by eye).
//
// The alias is a tag, not text (tests/intent/i18n-literal-text TAG_TYPES):
// the component reads `t(\`explain.${id}\`)`.
//
// "threshold", "lambda", "logAxis", "upperBound" and "phenomenological" are
// the chart's; "challengeRule" is the challenge mode's;
// "measurementFlip", "dataErrorPersists" and "finalPlane" are the spacetime
// viewer's.

export type ExplainId =
  | "qubit"
  | "stabilizer"
  | "matching"
  | "distance"
  | "verdictRule"
  | "measurementsPerfect"
  | "yError"
  | "challengeRule"
  | "threshold"
  | "lambda"
  | "logAxis"
  | "upperBound"
  | "phenomenological"
  | "measurementFlip"
  | "dataErrorPersists"
  | "finalPlane";

export const EXPLAIN_IDS: readonly ExplainId[] = [
  "qubit",
  "stabilizer",
  "matching",
  "distance",
  "verdictRule",
  "measurementsPerfect",
  "yError",
  "challengeRule",
  "threshold",
  "lambda",
  "logAxis",
  "upperBound",
  "phenomenological",
  "measurementFlip",
  "dataErrorPersists",
  "finalPlane",
];
