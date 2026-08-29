/** Validation Hierarchy (Constitution §14) — speculation vs. demonstrated demand. */
export const VALIDATION_LEVELS = [
  "LEVEL_0",
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
  "LEVEL_4",
  "LEVEL_5",
  "LEVEL_6",
  "LEVEL_7",
  "LEVEL_8",
] as const;
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];

export function isValidationLevel(value: string): value is ValidationLevel {
  return (VALIDATION_LEVELS as readonly string[]).includes(value);
}

export const VALIDATION_LEVEL_LABELS: Readonly<Record<ValidationLevel, string>> = {
  LEVEL_0: "Hypothesis",
  LEVEL_1: "Market evidence",
  LEVEL_2: "Repeated pain",
  LEVEL_3: "Payment/alternative evidence",
  LEVEL_4: "Customer confirmation",
  LEVEL_5: "Strong purchase commitment / pre-sale",
  LEVEL_6: "Paying customer",
  LEVEL_7: "Repeatable acquisition",
  LEVEL_8: "Profitable business",
};

export function validationLevelIndex(level: ValidationLevel): number {
  return VALIDATION_LEVELS.indexOf(level);
}
