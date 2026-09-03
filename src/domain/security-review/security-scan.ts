import type { SecurityFinding } from "./security-review.types.js";

interface ScanRule {
  category: string;
  pattern: RegExp;
  detail: string;
}

/**
 * The real, deterministic core of Security Review
 * (docs/M6_ARCHITECTURE_PROPOSAL.md §16, brief §17's "actual security
 * tests, not documentation claims"): a small, unambiguous set of
 * always-real vulnerability categories — never a fuzzy heuristic that
 * could plausibly false-positive on legitimate code. Every match
 * carries its own literal matched text as evidence. Runs for every
 * mode (never dev-only) — the deterministic ground truth a model's own
 * judgment is checked against, exactly like checkDependencies().
 */
const SECURITY_SCAN_RULES: readonly ScanRule[] = [
  { category: "code-injection", pattern: /\beval\(|\bnew Function\(/g, detail: "Dynamic code execution (eval/Function) can execute attacker-controlled strings as code." },
  { category: "hardcoded-secret", pattern: /\b(password|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{4,}["']/gi, detail: "A credential-shaped value is hardcoded as a string literal rather than sourced from configuration." },
  { category: "command-injection-risk", pattern: /\bexec(?:Sync)?\(/g, detail: "child_process.exec/execSync interprets its argument as a shell command — prefer execFile with an explicit argv array." },
];

export function scanForSecurityIssues(files: readonly { relativePath: string; content: string }[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    for (const rule of SECURITY_SCAN_RULES) {
      for (const match of file.content.matchAll(rule.pattern)) {
        findings.push({ category: rule.category, file: file.relativePath, detail: rule.detail, evidence: match[0] });
      }
    }
  }
  return findings;
}
