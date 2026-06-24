import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthSupportedAuthProvider } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { isAxiosError } from 'axios';
import { neonAuthDomainUpdateInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';

type Props = z.infer<typeof neonAuthDomainUpdateInputSchema>;

type UrlOutcome =
  | { url: string; ok: true }
  | { url: string; ok: false; error: string };

function describeError(err: unknown): string {
  if (isAxiosError(err) && err.response) {
    const { status, statusText, data } = err.response;
    const msg =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message ?? '')
        : '';
    return msg ? `${status} ${statusText}: ${msg}` : `${status} ${statusText}`;
  }
  if (err instanceof Error) return err.message;
  return 'unknown error';
}

async function addOne(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  url: string,
): Promise<UrlOutcome> {
  try {
    const res = await neonClient.addBranchNeonAuthTrustedDomain(
      projectId,
      branchId,
      {
        domain: url,
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
      },
    );
    if (res.status !== 201 && res.status !== 200) {
      return { url, ok: false, error: `${res.status} ${res.statusText}` };
    }
    return { url, ok: true };
  } catch (err) {
    return { url, ok: false, error: describeError(err) };
  }
}

async function removeOne(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  url: string,
): Promise<UrlOutcome> {
  // One delete request per URL — gives per-URL outcomes on partial failure
  // instead of collapsing the batch into a single status.
  try {
    const res = await neonClient.deleteBranchNeonAuthTrustedDomain(
      projectId,
      branchId,
      {
        auth_provider: NeonAuthSupportedAuthProvider.BetterAuth,
        domains: [{ domain: url }],
      },
    );
    if (res.status !== 200) {
      return { url, ok: false, error: `${res.status} ${res.statusText}` };
    }
    return { url, ok: true };
  } catch (err) {
    return { url, ok: false, error: describeError(err) };
  }
}

async function setAllowLocalhost(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  allow_localhost: boolean,
): Promise<
  { ok: true; allow_localhost: boolean } | { ok: false; error: string }
> {
  try {
    const res = await neonClient.updateNeonAuthAllowLocalhost(
      projectId,
      branchId,
      { allow_localhost },
    );
    if (res.status !== 200) {
      return { ok: false, error: `${res.status} ${res.statusText}` };
    }
    return { ok: true, allow_localhost: res.data.allow_localhost };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export async function handleNeonAuthDomainUpdate(
  props: Props,
  neonClient: Api<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  const branchId = await resolveNeonAuthBranchId(
    props.projectId,
    props.branchId,
    neonClient,
  );
  const preflight = await ensureNeonAuthProvisioned(
    neonClient,
    props.projectId,
    branchId,
  );
  if (preflight) return preflight;

  const addResults: UrlOutcome[] = [];
  const removeResults: UrlOutcome[] = [];
  let localhost:
    | { ok: true; allow_localhost: boolean }
    | { ok: false; error: string }
    | undefined;

  if (props.add && props.add.length > 0) {
    const results = await Promise.all(
      props.add.map((url) =>
        addOne(neonClient, props.projectId, branchId, url),
      ),
    );
    addResults.push(...results);
  }

  if (props.remove && props.remove.length > 0) {
    const results = await Promise.all(
      props.remove.map((url) =>
        removeOne(neonClient, props.projectId, branchId, url),
      ),
    );
    removeResults.push(...results);
  }

  if (props.allow_localhost !== undefined) {
    localhost = await setAllowLocalhost(
      neonClient,
      props.projectId,
      branchId,
      props.allow_localhost,
    );
  }

  const summary: Record<string, unknown> = {
    branch_id: branchId,
    add: addResults,
    remove: removeResults,
  };
  if (localhost !== undefined) summary.allow_localhost = localhost;

  const anyFailure =
    addResults.some((r) => !r.ok) ||
    removeResults.some((r) => !r.ok) ||
    (localhost !== undefined && !localhost.ok);

  if (!anyFailure) {
    return {
      content: [
        {
          type: 'text',
          text: `Trusted-domain update completed.\n\`\`\`json\n${JSON.stringify(
            summary,
            null,
            2,
          )}\n\`\`\``,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Trusted-domain update partially failed. Per-URL outcomes are listed below; succeeded entries are NOT rolled back. Re-call with only the failed entries.\n\`\`\`json\n${JSON.stringify(
          summary,
          null,
          2,
        )}\n\`\`\``,
      },
    ],
  };
}
