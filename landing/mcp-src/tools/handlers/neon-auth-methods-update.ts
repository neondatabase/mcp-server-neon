import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  Api,
  ContentType,
  NeonAuthEmailAndPasswordConfigUpdate,
  NeonAuthEmailServerConfig,
  NeonAuthOrganizationConfigUpdate,
} from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { isAxiosError } from 'axios';
import {
  neonAuthAppUpdateInputSchema,
  neonAuthEmailDeliveryUpdateInputSchema,
  neonAuthOrganizationsUpdateInputSchema,
  neonAuthSignInMethodsUpdateInputSchema,
} from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';

type SignInProps = z.infer<typeof neonAuthSignInMethodsUpdateInputSchema>;
type EmailDeliveryProps = z.infer<
  typeof neonAuthEmailDeliveryUpdateInputSchema
>;
type OrganizationsProps = z.infer<
  typeof neonAuthOrganizationsUpdateInputSchema
>;
type AppProps = z.infer<typeof neonAuthAppUpdateInputSchema>;

type SliceName =
  | 'app_name'
  | 'email_password'
  | 'magic_link'
  | 'phone'
  | 'email_delivery'
  | 'organizations';

type SliceResult =
  | { slice: SliceName; ok: true }
  | { slice: SliceName; ok: false; error: string };

function buildEmailPasswordPatch(
  email: NonNullable<SignInProps['email_password']>,
): NeonAuthEmailAndPasswordConfigUpdate {
  const patch: NeonAuthEmailAndPasswordConfigUpdate = {};
  if (email.enabled !== undefined) {
    patch.enabled = email.enabled;
  }
  if (email.allow_sign_up !== undefined) {
    patch.disable_sign_up = !email.allow_sign_up;
  }
  if (email.verify_email_on_sign_up !== undefined) {
    patch.send_verification_email_on_sign_up = email.verify_email_on_sign_up;
  }
  if (email.verify_email_on_sign_in !== undefined) {
    patch.send_verification_email_on_sign_in = email.verify_email_on_sign_in;
  }
  if (email.email_verification_method !== undefined) {
    patch.email_verification_method = email.email_verification_method;
  }
  if (email.require_email_verification !== undefined) {
    patch.require_email_verification = email.require_email_verification;
  }
  if (email.auto_sign_in_after_verification !== undefined) {
    patch.auto_sign_in_after_verification =
      email.auto_sign_in_after_verification;
  }
  return patch;
}

function describeError(err: unknown, statusFallback?: number): string {
  if (isAxiosError(err) && err.response) {
    const { status, statusText, data } = err.response;
    const msg =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message ?? '')
        : '';
    return msg ? `${status} ${statusText}: ${msg}` : `${status} ${statusText}`;
  }
  if (err instanceof Error) return err.message;
  if (statusFallback !== undefined) return `HTTP ${statusFallback}`;
  return 'unknown error';
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

// TODO(api-client-bump): swap raw `neonClient.request({...})` for typed
// `neonClient.updateNeonAuthConfig(projectId, branchId, { app_name })` once
// `@neondatabase/api-client` ships a version that exposes the method
// (`/auth/config` PATCH is `x-internal: true` today, so the SDK omits it —
// promotion to public + bump unlocks the typed call).
async function patchAppName(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  app_name: string,
): Promise<SliceResult> {
  try {
    const res = await neonClient.request({
      path: `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(
        branchId,
      )}/auth/config`,
      method: 'PATCH',
      body: { app_name },
      secure: true,
      type: ContentType.Json,
      format: 'json',
    });
    if (!isOk(res.status)) {
      return {
        slice: 'app_name',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'app_name', ok: true };
  } catch (err) {
    return { slice: 'app_name', ok: false, error: describeError(err) };
  }
}

// TODO(api-client-bump): swap raw `neonClient.request({...})` for typed
// `neonClient.updateNeonAuthMagicLinkPlugin(projectId, branchId, payload)`
// once `@neondatabase/api-client` ships a version >= the bump that picks up
// the magic-link endpoint added in goapp PR #5585.
async function patchMagicLink(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  payload: { enabled?: boolean },
): Promise<SliceResult> {
  try {
    const res = await neonClient.request({
      path: `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(
        branchId,
      )}/auth/plugins/magic-link`,
      method: 'PATCH',
      body: payload,
      secure: true,
      type: ContentType.Json,
      format: 'json',
    });
    if (!isOk(res.status)) {
      return {
        slice: 'magic_link',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'magic_link', ok: true };
  } catch (err) {
    return {
      slice: 'magic_link',
      ok: false,
      error: describeError(err),
    };
  }
}

// TODO(api-client-bump): swap raw `neonClient.request({...})` for typed
// `neonClient.updateNeonAuthPhoneNumberPlugin(projectId, branchId, payload)`
// once `@neondatabase/api-client` ships a version >= the bump that picks up
// the phone-number endpoint added in goapp PR #5599.
async function patchPhone(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  payload: { enabled?: boolean },
): Promise<SliceResult> {
  try {
    const res = await neonClient.request({
      path: `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(
        branchId,
      )}/auth/plugins/phone_number`,
      method: 'PATCH',
      body: payload,
      secure: true,
      type: ContentType.Json,
      format: 'json',
    });
    if (!isOk(res.status)) {
      return {
        slice: 'phone',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'phone', ok: true };
  } catch (err) {
    return {
      slice: 'phone',
      ok: false,
      error: describeError(err),
    };
  }
}

async function patchEmailPassword(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  patch: NeonAuthEmailAndPasswordConfigUpdate,
): Promise<SliceResult> {
  try {
    const res = await neonClient.updateNeonAuthEmailAndPasswordConfig(
      projectId,
      branchId,
      patch,
    );
    if (!isOk(res.status)) {
      return {
        slice: 'email_password',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'email_password', ok: true };
  } catch (err) {
    return {
      slice: 'email_password',
      ok: false,
      error: describeError(err),
    };
  }
}

async function patchEmailDelivery(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  payload: NeonAuthEmailServerConfig,
): Promise<SliceResult> {
  try {
    const res = await neonClient.updateNeonAuthEmailProvider(
      projectId,
      branchId,
      payload,
    );
    if (!isOk(res.status)) {
      return {
        slice: 'email_delivery',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'email_delivery', ok: true };
  } catch (err) {
    return { slice: 'email_delivery', ok: false, error: describeError(err) };
  }
}

async function patchOrganizations(
  neonClient: Api<unknown>,
  projectId: string,
  branchId: string,
  payload: NeonAuthOrganizationConfigUpdate,
): Promise<SliceResult> {
  try {
    const res = await neonClient.updateNeonAuthOrganizationPlugin(
      projectId,
      branchId,
      payload,
    );
    if (!isOk(res.status)) {
      return {
        slice: 'organizations',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'organizations', ok: true };
  } catch (err) {
    return { slice: 'organizations', ok: false, error: describeError(err) };
  }
}

function formatMutationResult(
  title: string,
  branchId: string,
  results: SliceResult[],
): CallToolResult {
  const succeeded = results.filter((r) => r.ok).map((r) => r.slice);
  const failed = results
    .filter((r): r is Extract<SliceResult, { ok: false }> => !r.ok)
    .map((r) => ({ slice: r.slice, error: r.error }));

  const summary = {
    branch_id: branchId,
    succeeded,
    failed,
  };

  if (failed.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `${title} updated successfully.\n\`\`\`json\n${JSON.stringify(
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
        text: `${title} update partially failed. Atomicity is per-slice; succeeded slices are NOT rolled back. Re-call with only the failed slices once the upstream issue is resolved.\n\`\`\`json\n${JSON.stringify(
          summary,
          null,
          2,
        )}\n\`\`\``,
      },
    ],
  };
}

export async function handleNeonAuthSignInMethodsUpdate(
  props: SignInProps,
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

  const tasks: Promise<SliceResult>[] = [];
  if (props.email_password) {
    tasks.push(
      patchEmailPassword(
        neonClient,
        props.projectId,
        branchId,
        buildEmailPasswordPatch(props.email_password),
      ),
    );
  }
  if (props.magic_link) {
    tasks.push(
      patchMagicLink(neonClient, props.projectId, branchId, props.magic_link),
    );
  }
  if (props.phone) {
    tasks.push(patchPhone(neonClient, props.projectId, branchId, props.phone));
  }

  return formatMutationResult(
    'Neon Auth sign-in methods',
    branchId,
    await Promise.all(tasks),
  );
}

export async function handleNeonAuthEmailDeliveryUpdate(
  props: EmailDeliveryProps,
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

  return formatMutationResult('Neon Auth email delivery', branchId, [
    await patchEmailDelivery(
      neonClient,
      props.projectId,
      branchId,
      props.email_delivery as NeonAuthEmailServerConfig,
    ),
  ]);
}

export async function handleNeonAuthOrganizationsUpdate(
  props: OrganizationsProps,
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

  const orgPayload: NeonAuthOrganizationConfigUpdate = {};
  if (props.organizations.enabled !== undefined) {
    orgPayload.enabled = props.organizations.enabled;
  }

  return formatMutationResult('Neon Auth organizations', branchId, [
    await patchOrganizations(neonClient, props.projectId, branchId, orgPayload),
  ]);
}

export async function handleNeonAuthAppUpdate(
  props: AppProps,
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

  return formatMutationResult('Neon Auth app config', branchId, [
    await patchAppName(neonClient, props.projectId, branchId, props.app_name),
  ]);
}
