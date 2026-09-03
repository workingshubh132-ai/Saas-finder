import { describe, expect, it } from "vitest";
import { scanForSecurityIssues } from "../../src/domain/security-review/security-scan.js";

describe("scanForSecurityIssues", () => {
  it("returns no findings for genuinely clean code", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/store.ts", content: 'export function list(): string[] {\n  return [];\n}\n' }]);
    expect(findings).toEqual([]);
  });

  it("detects eval() as code-injection, with the exact matched text as evidence", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/bad.ts", content: 'const result = eval(userInput);\n' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "code-injection", file: "src/bad.ts", evidence: "eval(" });
  });

  it("detects new Function() as code-injection", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/bad.ts", content: "const fn = new Function('return 1');\n" }]);
    expect(findings.some((f) => f.category === "code-injection")).toBe(true);
  });

  it("detects a hardcoded secret assigned as a string literal", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/config.ts", content: 'const apiKey = "sk-live-abcdef123456";\n' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "hardcoded-secret", file: "src/config.ts" });
    expect(findings[0]!.evidence).toContain("apiKey");
  });

  it("does not flag a secret sourced from configuration, only a literal", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/config.ts", content: "const apiKey = process.env.API_KEY;\n" }]);
    expect(findings).toEqual([]);
  });

  it("detects child_process.exec/execSync as a command-injection risk", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/run.ts", content: 'import { exec } from "node:child_process";\nexec(userCommand);\n' }]);
    expect(findings.some((f) => f.category === "command-injection-risk")).toBe(true);
  });

  it("does not flag execFile — the safe, parameterized alternative this codebase itself uses", () => {
    const findings = scanForSecurityIssues([{ relativePath: "src/run.ts", content: 'import { execFile } from "node:child_process";\nexecFile(bin, args);\n' }]);
    expect(findings).toEqual([]);
  });

  it("scans every file provided and reports each file's own findings against its own path", () => {
    const findings = scanForSecurityIssues([
      { relativePath: "src/a.ts", content: "eval(x);" },
      { relativePath: "src/b.ts", content: "export const y = 1;" },
      { relativePath: "src/c.ts", content: 'const password = "hunter2222";' },
    ]);
    expect(findings.map((f) => f.file).sort()).toEqual(["src/a.ts", "src/c.ts"]);
  });
});
