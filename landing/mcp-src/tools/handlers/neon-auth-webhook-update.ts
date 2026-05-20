import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Api, NeonAuthWebhookConfig } from '@neondatabase/api-client';
import { z } from 'zod/v3';
import { neonAuthWebhookUpdateInputSchema } from '../toolsSchema';
import { ToolHandlerExtraParams } from '../types';
import {
  ensureNeonAuthProvisioned,
  resolveNeonAuthBranchId,
} from './neon-auth-utils';

type Props = z.infer<typeof neonAuthWebhookUpdateInputSchema>;

export async function handleNeonAuthWebhookUpdate(
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

  const body: NeonAuthWebhookConfig = { enabled: props.enabled };
  if (props.url !== undefined) body.webhook_url = props.url;
  if (props.events !== undefined) {
    body.enabled_events =
      props.events as NeonAuthWebhookConfig['enabled_events'];
  }
  if (props.timeout_seconds !== undefined) {
    body.timeout_seconds = props.timeout_seconds;
  }

  const res = await neonClient.updateNeonAuthWebhookConfig(
    props.projectId,
    branchId,
    body,
  );
  if (res.status !== 200 && res.status !== 204) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to update Neon Auth webhook config (${res.status} ${res.statusText}).`,
        },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: `Neon Auth webhook config updated for branch ${branchId}.`,
      },
    ],
  };
}
