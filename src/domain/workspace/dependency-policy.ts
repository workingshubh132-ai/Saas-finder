import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const IMPORT_FROM_RE = /\bfrom\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s+["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** Every bare-specifier or relative import/require string literal referenced anywhere in a generated file's own text — a plain static scan, never an executed one. */
export function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const re of [IMPORT_FROM_RE, BARE_IMPORT_RE, REQUIRE_RE]) {
    for (const match of source.matchAll(re)) {
      const spec = match[1];
      if (spec) specifiers.add(spec);
    }
  }
  return [...specifiers];
}

function isRelativeSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function isNodeBuiltinSpecifier(spec: string): boolean {
  const bare = spec.startsWith("node:") ? spec.slice("node:".length) : spec;
  return (builtinModules as readonly string[]).includes(bare);
}

/** "@scope/pkg/sub/path" -> "@scope/pkg"; "express/lib/x" -> "express". */
function packageNameFromSpecifier(spec: string): string {
  const parts = spec.split("/");
  if (spec.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] as string;
}

/**
 * Blocked even though genuinely installed and walk-up resolvable —
 * "already installed" is necessary but not sufficient (docs/M6_ARCHITECTURE_PROPOSAL.md
 * §10, §17, and the product database isolation model): `@prisma/client`
 * is VentureForge's own connection to its own database (the one thing
 * a generated product must never be able to reach — a second Prisma
 * schema/database is the sanctioned path, never this), and `dotenv` has
 * no legitimate role in a generated MVP that ships no real secrets yet.
 * Both stay blocked regardless of what VentureForge itself depends on.
 */
const DENIED_PACKAGES = new Set(["@prisma/client", "dotenv"]);

let cachedAllowedPackages: Set<string> | null = null;

/**
 * VentureForge's own package.json — the real, always-in-sync source of
 * truth for what a generated workspace's module-resolution walk-up can
 * actually find (docs/M6_ARCHITECTURE_PROPOSAL.md §10, §17): no
 * `npm install` ever runs inside a factory workspace, so a generated
 * file may only import a bare specifier that is either a Node builtin,
 * a relative path, or a package already installed here (and not on
 * DENIED_PACKAGES). Resolved via import.meta.url rather than
 * process.cwd() so it is correct regardless of the caller's working
 * directory.
 */
function loadAllowedPackages(): Set<string> {
  if (cachedAllowedPackages) return cachedAllowedPackages;
  const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf-8");
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const installed = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  for (const denied of DENIED_PACKAGES) installed.delete(denied);
  cachedAllowedPackages = installed;
  return cachedAllowedPackages;
}

export interface DependencyCheckResult {
  /** Real external packages referenced, already installed and resolvable — safe to record as this task's DependencyRecord[] (schema §17). */
  allowed: string[];
  /** External packages referenced that are not installed anywhere this workspace's module resolution walk-up can reach — never written to disk (§13's own "fail closed" discipline extended to generated code's own imports). */
  violations: string[];
}

/** The dependency policy itself (docs/M6_ARCHITECTURE_PROPOSAL.md §17) — deterministic, never the model's own say-so. */
export function checkDependencies(fileContents: readonly string[]): DependencyCheckResult {
  const allowedPackages = loadAllowedPackages();
  const allowed = new Set<string>();
  const violations = new Set<string>();

  for (const content of fileContents) {
    for (const spec of extractImportSpecifiers(content)) {
      if (isRelativeSpecifier(spec) || isNodeBuiltinSpecifier(spec)) continue;
      const packageName = packageNameFromSpecifier(spec);
      if (allowedPackages.has(packageName)) {
        allowed.add(packageName);
      } else {
        violations.add(packageName);
      }
    }
  }

  return { allowed: [...allowed], violations: [...violations] };
}
