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
import { neonAuthMethodsUpdateInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import { resolveNeonAuthBranchId } from './neon-auth-utils';

type Props = z.infer<typeof neonAuthMethodsUpdateInputSchema>;

type SliceName =
  | 'app_name'
  | 'sign_in_methods.email_password'
  | 'sign_in_methods.magic_link'
  | 'sign_in_methods.phone'
  | 'email_delivery'
  | 'organizations';

type SliceResult =
  | { slice: SliceName; ok: true }
  | { slice: SliceName; ok: false; error: string };

function buildEmailPasswordPatch(
  email: NonNullable<NonNullable<Props['sign_in_methods']>['email_password']>,
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
        slice: 'sign_in_methods.magic_link',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'sign_in_methods.magic_link', ok: true };
  } catch (err) {
    return {
      slice: 'sign_in_methods.magic_link',
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
        slice: 'sign_in_methods.phone',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'sign_in_methods.phone', ok: true };
  } catch (err) {
    return {
      slice: 'sign_in_methods.phone',
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
        slice: 'sign_in_methods.email_password',
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    return { slice: 'sign_in_methods.email_password', ok: true };
  } catch (err) {
    return {
      slice: 'sign_in_methods.email_password',
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

export async function handleNeonAuthMethodsUpdate(
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

  const tasks: Promise<SliceResult>[] = [];

  if (props.app_name !== undefined) {
    tasks.push(
      patchAppName(neonClient, props.projectId, branchId, props.app_name),
    );
  }
  if (props.sign_in_methods?.email_password) {
    tasks.push(
      patchEmailPassword(
        neonClient,
        props.projectId,
        branchId,
        buildEmailPasswordPatch(props.sign_in_methods.email_password),
      ),
    );
  }
  if (props.sign_in_methods?.magic_link) {
    tasks.push(
      patchMagicLink(
        neonClient,
        props.projectId,
        branchId,
        props.sign_in_methods.magic_link,
      ),
    );
  }
  if (props.sign_in_methods?.phone) {
    tasks.push(
      patchPhone(
        neonClient,
        props.projectId,
        branchId,
        props.sign_in_methods.phone,
      ),
    );
  }
  if (props.email_delivery) {
    tasks.push(
      patchEmailDelivery(
        neonClient,
        props.projectId,
        branchId,
        props.email_delivery as NeonAuthEmailServerConfig,
      ),
    );
  }
  if (props.organizations) {
    const orgPayload: NeonAuthOrganizationConfigUpdate = {};
    if (props.organizations.enabled !== undefined) {
      orgPayload.enabled = props.organizations.enabled;
    }
    tasks.push(
      patchOrganizations(neonClient, props.projectId, branchId, orgPayload),
    );
  }

  const results = await Promise.all(tasks);
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
          text: `Neon Auth methods updated successfully.\n\`\`\`json\n${JSON.stringify(
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
        text: `Neon Auth methods update partially failed. Atomicity is per-slice; succeeded slices are NOT rolled back. Re-call with only the failed slices once the upstream issue is resolved.\n\`\`\`json\n${JSON.stringify(
          summary,
          null,
          2,
        )}\n\`\`\``,
      },
    ],
  };
}
