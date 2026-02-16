/**
 * Integration tests for createMcpServer with different grant contexts.
 *
 * These tests verify that:
 * - Tool registration changes based on grant presets
 * - Project-scoped servers have fewer tools
 * - Read-only mode filters tools correctly
 *
 * We mock analytics, Sentry, and the Neon API client since we don't
 * want to make real API calls. We test the server construction and
 * tool registration pipeline only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GrantContext } from "../utils/grant-context";
import type { ServerContext } from "../types/context";
import { NEON_TOOLS } from "../tools/definitions";

// Mock external services before importing the server module
vi.mock("../analytics/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: (span: unknown) => unknown) =>
    fn({ setStatus: vi.fn() }),
  ),
}));

vi.mock("../sentry/utils", () => ({
  setSentryTags: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    silent: false,
  },
}));

vi.mock("../server/api", () => ({
  createNeonClient: () => ({
    getProject: vi
      .fn()
      .mockResolvedValue({ data: { project: { id: "mock" } } }),
  }),
}));

// Import after mocks are set up
const { createMcpServer } = await import("../server/index");

/**
 * Build a minimal ServerContext for testing.
 */
function buildContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    apiKey: "test-api-key-not-real",
    account: {
      id: "test-account-id",
      name: "Test Account",
      email: "test@example.com",
    },
    app: {
      name: "test-app",
      transport: "stdio",
      environment: "development",
      version: "0.0.0-test",
    },
    ...overrides,
  };
}

/**
 * Extract registered tool names from an McpServer instance.
 *
 * The MCP SDK stores tools in `_registeredTools` on the McpServer instance.
 * We access it for testing purposes only.
 */
function getRegisteredToolNames(
  server: Awaited<ReturnType<typeof createMcpServer>>,
): string[] {
  const registeredTools = (server as unknown as Record<string, unknown>)
    ._registeredTools as Record<string, { enabled: boolean }>;
  return Object.keys(registeredTools);
}

// ---------------------------------------------------------------------------
// Server creation with different grants
// ---------------------------------------------------------------------------
describe("createMcpServer – tool registration based on grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all tools with default (full_access) grant", async () => {
    const server = await createMcpServer(buildContext());
    const names = getRegisteredToolNames(server);
    expect(names).toHaveLength(NEON_TOOLS.length);
  });

  it("registers only readOnlySafe tools with production_use preset", async () => {
    const grant: GrantContext = {
      projectId: null,
      preset: "production_use",
      scopes: null,
      protectedBranches: null,
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    // production_use filters to readOnlySafe + always-available
    const expectedReadOnlyTools = NEON_TOOLS.filter(
      (t) => t.readOnlySafe || t.name === "search" || t.name === "fetch",
    );
    expect(names).toHaveLength(expectedReadOnlyTools.length);

    // Should not contain any write-only tools
    expect(names).not.toContain("create_project");
    expect(names).not.toContain("delete_project");
    expect(names).not.toContain("create_branch");
    expect(names).not.toContain("delete_branch");
  });

  it("registers all tools except create/delete project with local_development preset", async () => {
    const grant: GrantContext = {
      projectId: null,
      preset: "local_development",
      scopes: null,
      protectedBranches: null,
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    expect(names).toHaveLength(NEON_TOOLS.length - 2);
    expect(names).not.toContain("create_project");
    expect(names).not.toContain("delete_project");
    // But write tools for branches should be there
    expect(names).toContain("create_branch");
    expect(names).toContain("delete_branch");
  });

  it("hides project-agnostic tools with project-scoped grant", async () => {
    const grant: GrantContext = {
      projectId: "proj-test-123",
      preset: "full_access",
      scopes: null,
      protectedBranches: null,
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    expect(names).not.toContain("list_projects");
    expect(names).not.toContain("list_organizations");
    expect(names).not.toContain("list_shared_projects");
    expect(names).not.toContain("create_project");
    expect(names).not.toContain("delete_project");

    // But project-specific tools should be present
    expect(names).toContain("describe_project");
    expect(names).toContain("run_sql");
    expect(names).toContain("create_branch");
  });

  it("custom preset with specific scopes only registers matching tools", async () => {
    const grant: GrantContext = {
      projectId: null,
      preset: "custom",
      scopes: ["schema", "docs"],
      protectedBranches: null,
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    // schema: describe_table_schema, get_database_tables
    // docs: list_docs_resources, get_doc_resource
    // always-available: search, fetch
    expect(names).toContain("describe_table_schema");
    expect(names).toContain("get_database_tables");
    expect(names).toContain("list_docs_resources");
    expect(names).toContain("get_doc_resource");
    expect(names).toContain("search");
    expect(names).toContain("fetch");

    // Tools from other scopes should NOT be registered
    expect(names).not.toContain("run_sql");
    expect(names).not.toContain("list_projects");
    expect(names).not.toContain("create_branch");
    expect(names).not.toContain("explain_sql_statement");
  });

  it("readOnly context flag further filters tools", async () => {
    // Even with full_access, if readOnly is true on context, only readOnlySafe tools remain
    const server = await createMcpServer(buildContext({ readOnly: true }));
    const names = getRegisteredToolNames(server);

    const readOnlyTools = NEON_TOOLS.filter((t) => t.readOnlySafe);
    expect(names).toHaveLength(readOnlyTools.length);
  });

  it("combined: production_use + project-scoped", async () => {
    const grant: GrantContext = {
      projectId: "proj-abc",
      preset: "production_use",
      scopes: null,
      protectedBranches: ["main"],
    };
    const server = await createMcpServer(buildContext({ grant }));
    const names = getRegisteredToolNames(server);

    // Should be readOnlySafe tools minus project-agnostic tools
    expect(names).not.toContain("list_projects");
    expect(names).not.toContain("create_project");
    expect(names).not.toContain("create_branch");
    expect(names).toContain("describe_project");
    expect(names).toContain("run_sql");
  });
});
