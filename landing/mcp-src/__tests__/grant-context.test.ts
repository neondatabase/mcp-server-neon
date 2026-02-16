import { describe, it, expect } from "vitest";
import {
  resolveGrantFromHeaders,
  resolveGrantFromCliArgs,
  resolveGrantFromToken,
  parseProtectedBranches,
  parseScopeCategories,
  DEFAULT_GRANT,
  DEFAULT_PROTECTED_BRANCHES,
  type GrantContext,
} from "../utils/grant-context";

// ---------------------------------------------------------------------------
// parseProtectedBranches
// ---------------------------------------------------------------------------
describe("parseProtectedBranches", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(parseProtectedBranches(null)).toBeNull();
    expect(parseProtectedBranches(undefined)).toBeNull();
    expect(parseProtectedBranches("")).toBeNull();
  });

  it('returns null for "false"', () => {
    expect(parseProtectedBranches("false")).toBeNull();
    expect(parseProtectedBranches("FALSE")).toBeNull();
    expect(parseProtectedBranches("False")).toBeNull();
  });

  it('returns default protected branches for "true"', () => {
    expect(parseProtectedBranches("true")).toEqual(DEFAULT_PROTECTED_BRANCHES);
    expect(parseProtectedBranches("TRUE")).toEqual(DEFAULT_PROTECTED_BRANCHES);
  });

  it("returns a fresh copy (not same reference)", () => {
    const result = parseProtectedBranches("true");
    expect(result).not.toBe(DEFAULT_PROTECTED_BRANCHES);
  });

  it("parses comma-separated branch names", () => {
    expect(parseProtectedBranches("staging,preview")).toEqual([
      "staging",
      "preview",
    ]);
  });

  it("trims whitespace around branch names", () => {
    expect(parseProtectedBranches(" staging , preview ")).toEqual([
      "staging",
      "preview",
    ]);
  });

  it("filters out empty segments", () => {
    expect(parseProtectedBranches("staging,,preview")).toEqual([
      "staging",
      "preview",
    ]);
  });

  it("handles a single branch name", () => {
    expect(parseProtectedBranches("deploy")).toEqual(["deploy"]);
  });
});

// ---------------------------------------------------------------------------
// parseScopeCategories
// ---------------------------------------------------------------------------
describe("parseScopeCategories", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(parseScopeCategories(null)).toBeNull();
    expect(parseScopeCategories(undefined)).toBeNull();
    expect(parseScopeCategories("")).toBeNull();
  });

  it("parses valid comma-separated categories", () => {
    expect(parseScopeCategories("projects,branches,querying")).toEqual([
      "projects",
      "branches",
      "querying",
    ]);
  });

  it("silently filters out invalid categories", () => {
    expect(parseScopeCategories("projects,invalid,branches")).toEqual([
      "projects",
      "branches",
    ]);
  });

  it("returns empty array when all categories are invalid (header was present)", () => {
    expect(parseScopeCategories("foo,bar")).toEqual([]);
  });

  it("trims whitespace", () => {
    expect(parseScopeCategories(" schema , docs ")).toEqual(["schema", "docs"]);
  });

  it("handles all valid categories", () => {
    const all = "projects,branches,schema,querying,performance,neon_auth,docs";
    const result = parseScopeCategories(all);
    expect(result).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// resolveGrantFromHeaders
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("returns DEFAULT_GRANT when no headers are present", () => {
    const grant = resolveGrantFromHeaders(headers({}));
    expect(grant).toEqual(DEFAULT_GRANT);
  });

  it("respects X-Neon-Preset header", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "local_development" }),
    );
    expect(grant.preset).toBe("local_development");
    expect(grant.scopes).toBeNull();
  });

  it("falls back to full_access for invalid preset", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "not_a_preset" }),
    );
    expect(grant.preset).toBe("full_access");
  });

  it('X-Neon-Scopes overrides X-Neon-Preset to "custom"', () => {
    const grant = resolveGrantFromHeaders(
      headers({
        "x-neon-preset": "full_access",
        "x-neon-scopes": "projects,querying",
      }),
    );
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual(["projects", "querying"]);
  });

  it('X-Neon-Scopes alone implies "custom"', () => {
    const grant = resolveGrantFromHeaders(headers({ "x-neon-scopes": "docs" }));
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual(["docs"]);
  });

  it("extracts X-Neon-Project-Id", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-project-id": "proj-abc-123" }),
    );
    expect(grant.projectId).toBe("proj-abc-123");
  });

  it("trims whitespace from project ID", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-project-id": "  proj-abc-123  " }),
    );
    expect(grant.projectId).toBe("proj-abc-123");
  });

  it("returns null projectId when header is empty", () => {
    const grant = resolveGrantFromHeaders(headers({ "x-neon-project-id": "" }));
    expect(grant.projectId).toBeNull();
  });

  it("parses X-Neon-Protect-Production: true", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-protect-production": "true" }),
    );
    expect(grant.protectedBranches).toEqual(DEFAULT_PROTECTED_BRANCHES);
  });

  it("parses X-Neon-Protect-Production: branch list", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-protect-production": "staging,deploy" }),
    );
    expect(grant.protectedBranches).toEqual(["staging", "deploy"]);
  });

  it("combines all headers together", () => {
    const grant = resolveGrantFromHeaders(
      headers({
        "x-neon-scopes": "branches,querying",
        "x-neon-project-id": "proj-xyz",
        "x-neon-protect-production": "true",
      }),
    );
    expect(grant).toEqual({
      projectId: "proj-xyz",
      preset: "custom",
      scopes: ["branches", "querying"],
      protectedBranches: DEFAULT_PROTECTED_BRANCHES,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveGrantFromCliArgs
// ---------------------------------------------------------------------------
describe("resolveGrantFromCliArgs", () => {
  it("returns DEFAULT_GRANT for empty args", () => {
    const grant = resolveGrantFromCliArgs({});
    expect(grant).toEqual(DEFAULT_GRANT);
  });

  it("respects preset flag", () => {
    const grant = resolveGrantFromCliArgs({ preset: "production_use" });
    expect(grant.preset).toBe("production_use");
  });

  it("falls back to full_access for invalid preset", () => {
    const grant = resolveGrantFromCliArgs({ preset: "bogus" });
    expect(grant.preset).toBe("full_access");
  });

  it('--scopes overrides --preset to "custom"', () => {
    const grant = resolveGrantFromCliArgs({
      preset: "full_access",
      scopes: "schema,docs",
    });
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual(["schema", "docs"]);
  });

  it('--scopes alone implies "custom"', () => {
    const grant = resolveGrantFromCliArgs({ scopes: "performance" });
    expect(grant.preset).toBe("custom");
  });

  it("parses --project-id", () => {
    const grant = resolveGrantFromCliArgs({ projectId: "proj-123" });
    expect(grant.projectId).toBe("proj-123");
  });

  it("parses --protect-production", () => {
    const grant = resolveGrantFromCliArgs({ protectProduction: "true" });
    expect(grant.protectedBranches).toEqual(DEFAULT_PROTECTED_BRANCHES);
  });

  it("parses --protect-production with branch names", () => {
    const grant = resolveGrantFromCliArgs({
      protectProduction: "staging,deploy",
    });
    expect(grant.protectedBranches).toEqual(["staging", "deploy"]);
  });
});

// ---------------------------------------------------------------------------
// resolveGrantFromToken
// ---------------------------------------------------------------------------
describe("resolveGrantFromToken", () => {
  it("returns DEFAULT_GRANT when token has no grant", () => {
    const grant = resolveGrantFromToken({});
    expect(grant).toEqual(DEFAULT_GRANT);
  });

  it("returns a copy of DEFAULT_GRANT (not same reference)", () => {
    const grant = resolveGrantFromToken({});
    expect(grant).not.toBe(DEFAULT_GRANT);
  });

  it("returns the token grant when present", () => {
    const tokenGrant: GrantContext = {
      projectId: "proj-from-token",
      preset: "local_development",
      scopes: null,
      protectedBranches: ["main"],
    };
    const grant = resolveGrantFromToken({ grant: tokenGrant });
    expect(grant).toBe(tokenGrant);
  });

  it("returns DEFAULT_GRANT when token grant is undefined", () => {
    const grant = resolveGrantFromToken({ grant: undefined });
    expect(grant).toEqual(DEFAULT_GRANT);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: case-sensitive preset values
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders – case-sensitive preset values", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it('"Local_Development" (wrong case) falls back to full_access', () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "Local_Development" }),
    );
    expect(grant.preset).toBe("full_access");
  });

  it('"FULL_ACCESS" (all caps) falls back to full_access', () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "FULL_ACCESS" }),
    );
    expect(grant.preset).toBe("full_access");
  });

  it('"Production_Use" (title case) falls back to full_access', () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "Production_Use" }),
    );
    expect(grant.preset).toBe("full_access");
  });

  it('"CUSTOM" (all caps) falls back to full_access', () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "CUSTOM" }),
    );
    expect(grant.preset).toBe("full_access");
  });
});

// ---------------------------------------------------------------------------
// Edge cases: X-Neon-Preset: custom without scopes
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders – custom preset without scopes", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it('"custom" preset without X-Neon-Scopes uses custom with null scopes', () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-preset": "custom" }),
    );
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases: all-invalid scopes trigger custom preset with empty scopes
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders – all-invalid scopes", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("all-invalid scopes result in custom preset with empty scopes array", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-scopes": "invalid1,invalid2" }),
    );
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual([]);
  });

  it("all-invalid scopes override preset to custom", () => {
    const grant = resolveGrantFromHeaders(
      headers({
        "x-neon-preset": "full_access",
        "x-neon-scopes": "bogus,nope",
      }),
    );
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: whitespace-only project ID
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders – whitespace-only project ID", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("whitespace-only project ID becomes null", () => {
    const grant = resolveGrantFromHeaders(
      headers({ "x-neon-project-id": "   " }),
    );
    expect(grant.projectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases: duplicate and special branch names
// ---------------------------------------------------------------------------
describe("parseProtectedBranches – edge cases", () => {
  it("duplicate branch names are preserved (not deduplicated)", () => {
    const result = parseProtectedBranches("main,main,prod");
    expect(result).toEqual(["main", "main", "prod"]);
  });

  it('"true,false" are treated as literal branch names', () => {
    const result = parseProtectedBranches("true,false");
    expect(result).toEqual(["true", "false"]);
  });

  it("whitespace-only string returns null", () => {
    const result = parseProtectedBranches("   ");
    expect(result).toBeNull();
  });

  it("only commas and whitespace returns empty array (all segments empty after trim)", () => {
    const result = parseProtectedBranches("  ,  ,  ");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: invalid preset combined with valid scopes
// ---------------------------------------------------------------------------
describe("resolveGrantFromHeaders – invalid preset + valid scopes", () => {
  function headers(map: Record<string, string>): Headers {
    return new Headers(map);
  }

  it("invalid preset is ignored when scopes are present", () => {
    const grant = resolveGrantFromHeaders(
      headers({
        "x-neon-preset": "not_a_preset",
        "x-neon-scopes": "projects,schema",
      }),
    );
    expect(grant.preset).toBe("custom");
    expect(grant.scopes).toEqual(["projects", "schema"]);
  });
});
