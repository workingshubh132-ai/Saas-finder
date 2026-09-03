import { describe, expect, it } from "vitest";
import { checkDependencies, extractImportSpecifiers } from "../../src/domain/workspace/dependency-policy.js";

describe("extractImportSpecifiers", () => {
  it("finds ES import, bare import, and require specifiers, de-duplicated", () => {
    const source = [
      `import express from "express";`,
      `import { z } from "zod";`,
      `import "./side-effect.js";`,
      `const fs = require("node:fs");`,
      `import express from "express";`, // duplicate, collapsed
    ].join("\n");
    expect(extractImportSpecifiers(source)).toEqual(expect.arrayContaining(["express", "zod", "./side-effect.js", "node:fs"]));
    expect(extractImportSpecifiers(source)).toHaveLength(4);
  });
});

describe("checkDependencies", () => {
  it("allows relative imports and Node builtins without listing them as external dependencies", () => {
    const result = checkDependencies([`import { create } from "./store.js";\nimport { readFile } from "node:fs/promises";\n`]);
    expect(result.allowed).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("allows a real VentureForge dependency (express) actually installed and walk-up resolvable", () => {
    const result = checkDependencies([`import express from "express";\n`]);
    expect(result.allowed).toEqual(["express"]);
    expect(result.violations).toEqual([]);
  });

  it("flags a package that is not installed anywhere the workspace can resolve, never allowing it through", () => {
    const result = checkDependencies([`import evil from "definitely-not-a-real-installed-package";\n`]);
    expect(result.violations).toEqual(["definitely-not-a-real-installed-package"]);
    expect(result.allowed).toEqual([]);
  });

  it("resolves a deep import path to its real top-level package name", () => {
    const result = checkDependencies([`import sub from "express/lib/router";\n`]);
    expect(result.allowed).toEqual(["express"]);
  });

  it("scans every provided file, merging results", () => {
    const result = checkDependencies([`import express from "express";\n`, `import bad from "not-installed";\n`]);
    expect(result.allowed).toEqual(["express"]);
    expect(result.violations).toEqual(["not-installed"]);
  });

  it("blocks @prisma/client even though it is genuinely installed — a generated product must never reach VentureForge's own database", () => {
    const result = checkDependencies([`import { PrismaClient } from "@prisma/client";\n`]);
    expect(result.violations).toEqual(["@prisma/client"]);
    expect(result.allowed).toEqual([]);
  });

  it("blocks dotenv even though it is genuinely installed — no legitimate role in a generated MVP with no real secrets yet", () => {
    const result = checkDependencies([`import "dotenv/config";\n`]);
    expect(result.violations).toEqual(["dotenv"]);
    expect(result.allowed).toEqual([]);
  });
});
