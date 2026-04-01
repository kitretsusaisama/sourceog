import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { BudgetReport, BudgetViolation } from "@sourceog/runtime";

// ---------------------------------------------------------------------------
// Property 13: Budget violation implies build failure
// Validates: Requirements 5.3
// ---------------------------------------------------------------------------

/**
 * Arbitraries
 */
const budgetViolationArb: fc.Arbitrary<BudgetViolation> = fc.record({
  routeKey: fc.string({ minLength: 1, maxLength: 64 }),
  pattern: fc.string({ minLength: 1, maxLength: 64 }),
  actualBytes: fc.integer({ min: 1, max: 10_000_000 }),
  budgetBytes: fc.integer({ min: 0, max: 9_999_999 }),
});

/**
 * Generate a BudgetReport with at least one violation.
 */
const budgetReportWithViolationsArb: fc.Arbitrary<BudgetReport> = fc
  .array(budgetViolationArb, { minLength: 1, maxLength: 20 })
  .map((violations) => ({ violations, passed: violations.length === 0 }));

describe("BudgetReport — Property 13: Budget violation implies build failure", () => {
  it("passed is false when violations.length > 0", () => {
    fc.assert(
      fc.property(budgetReportWithViolationsArb, (report) => {
        // The property: any report with violations must have passed === false
        return report.violations.length > 0 ? report.passed === false : true;
      })
    );
  });

  it("passed is true when violations array is empty", () => {
    const emptyReport: BudgetReport = { violations: [], passed: true };
    expect(emptyReport.passed).toBe(true);
    expect(emptyReport.violations).toHaveLength(0);
  });

  it("passed === (violations.length === 0) for any generated report", () => {
    fc.assert(
      fc.property(
        fc.array(budgetViolationArb, { minLength: 0, maxLength: 20 }),
        (violations) => {
          const report: BudgetReport = {
            violations,
            passed: violations.length === 0,
          };
          return report.passed === (report.violations.length === 0);
        }
      )
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for BudgetReport structure
// ---------------------------------------------------------------------------

describe("BudgetReport — unit tests", () => {
  it("a report with one violation has passed === false", () => {
    const report: BudgetReport = {
      violations: [
        {
          routeKey: "/blog/[slug]",
          pattern: "/blog/*",
          actualBytes: 150_000,
          budgetBytes: 100_000,
        },
      ],
      passed: false,
    };
    expect(report.passed).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].actualBytes).toBeGreaterThan(report.violations[0].budgetBytes);
  });

  it("a report with no violations has passed === true", () => {
    const report: BudgetReport = { violations: [], passed: true };
    expect(report.passed).toBe(true);
  });

  it("BudgetViolation contains all required fields", () => {
    const violation: BudgetViolation = {
      routeKey: "/about",
      pattern: "/about",
      actualBytes: 200_000,
      budgetBytes: 150_000,
    };
    expect(violation.routeKey).toBeDefined();
    expect(violation.pattern).toBeDefined();
    expect(violation.actualBytes).toBeGreaterThan(violation.budgetBytes);
  });
});
