/**
 * Tests for CLI argument parsing in initConfig.ts.
 *
 * The parseFlag, parseBooleanOrValueFlag, and parseGrantArgs functions are
 * module-private. We test them indirectly by testing parseArgs with a
 * controlled process.argv. parseArgs calls process.exit on invalid input,
 * so we mock that to capture behavior.
 *
 * For the grant-related parsing specifically, we test the same logic via
 * resolveGrantFromCliArgs (which consumes the same CliGrantArgs shape).
 * This file focuses on verifying the CLI flag extraction works end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to control process.argv and prevent process.exit
const originalArgv = process.argv;
const originalExit = process.exit;

function withArgv(args: string[], fn: () => void) {
  process.argv = ["node", "cli.js", ...args];
  try {
    fn();
  } finally {
    process.argv = originalArgv;
  }
}

describe("parseArgs – start command with grant flags", () => {
  beforeEach(() => {
    // Prevent actual exit
    process.exit = vi.fn() as never;
    // Suppress logger output
    vi.mock("../utils/logger", () => ({
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    process.exit = originalExit;
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('parses "start <key>" with no grant flags', async () => {
    withArgv(["start", "napi_test_key"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      expect(result).toEqual({
        command: "start",
        neonApiKey: "napi_test_key",
        analytics: true,
        grantArgs: {
          preset: undefined,
          scopes: undefined,
          projectId: undefined,
          protectProduction: undefined,
        },
      });
    });
  });

  it("parses --preset flag (= syntax)", async () => {
    withArgv(["start", "napi_key", "--preset=local_development"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.grantArgs.preset).toBe("local_development");
    });
  });

  it("parses --preset flag (space syntax)", async () => {
    withArgv(["start", "napi_key", "--preset", "production_use"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.grantArgs.preset).toBe("production_use");
    });
  });

  it("parses --project-id flag", async () => {
    withArgv(["start", "napi_key", "--project-id", "proj-abc"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.grantArgs.projectId).toBe("proj-abc");
    });
  });

  it("parses --scopes flag", async () => {
    withArgv(["start", "napi_key", "--scopes=branches,querying"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.grantArgs.scopes).toBe("branches,querying");
    });
  });

  it("parses --protect-production as boolean flag", async () => {
    withArgv(["start", "napi_key", "--protect-production"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.grantArgs.protectProduction).toBe("true");
    });
  });

  it("parses --protect-production with value", async () => {
    withArgv(
      ["start", "napi_key", "--protect-production=staging,deploy"],
      async () => {
        const { parseArgs } = await import("../initConfig");
        const result = parseArgs();
        if (result.command !== "start") throw new Error("wrong command");
        expect(result.grantArgs.protectProduction).toBe("staging,deploy");
      },
    );
  });

  it("parses multiple grant flags together", async () => {
    withArgv(
      [
        "start",
        "napi_key",
        "--preset",
        "local_development",
        "--project-id=proj-xyz",
        "--protect-production",
      ],
      async () => {
        const { parseArgs } = await import("../initConfig");
        const result = parseArgs();
        if (result.command !== "start") throw new Error("wrong command");
        expect(result.grantArgs).toEqual({
          preset: "local_development",
          scopes: undefined,
          projectId: "proj-xyz",
          protectProduction: "true",
        });
      },
    );
  });

  it("parses --no-analytics flag", async () => {
    withArgv(["start", "napi_key", "--no-analytics"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      if (result.command !== "start") throw new Error("wrong command");
      expect(result.analytics).toBe(false);
    });
  });

  it("parses export-tools command", async () => {
    withArgv(["export-tools"], async () => {
      const { parseArgs } = await import("../initConfig");
      const result = parseArgs();
      expect(result).toEqual({ command: "export-tools" });
    });
  });
});
