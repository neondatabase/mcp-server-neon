import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthSendTestEmailInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';

type Props = z.infer<typeof neonAuthSendTestEmailInputSchema>;

export async function handleNeonAuthSendTestEmail(
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

  const res = await neonClient.sendNeonAuthTestEmail(
    props.projectId,
    branchId,
    {
      recipient_email: props.recipient_email,
      host: props.host,
      port: props.port,
      username: props.username,
      password: props.password,
      sender_email: props.sender_email,
      sender_name: props.sender_name,
    },
  );
  if (res.status !== 200) {
    const upstreamMessage =
      typeof res.data === 'object' &&
      res.data !== null &&
      'error_message' in res.data &&
      typeof (res.data as { error_message?: unknown }).error_message ===
        'string'
        ? (res.data as { error_message: string }).error_message
        : undefined;
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: upstreamMessage
            ? `Failed to dispatch test email request (${res.status} ${res.statusText}).\nUpstream error: ${upstreamMessage}`
            : `Failed to dispatch test email request (${res.status} ${res.statusText}).`,
        },
      ],
    };
  }
  const { success, error_message } = res.data;
  const header = success
    ? `Test email dispatched to ${props.recipient_email} via ${props.host}:${props.port}.`
    : `Test email could NOT be sent to ${props.recipient_email} via ${props.host}:${props.port}.`;
  const detail = error_message ? `\nUpstream error: ${error_message}` : '';
  return {
    isError: !success,
    content: [{ type: 'text', text: `${header}${detail}` }],
  };
}
