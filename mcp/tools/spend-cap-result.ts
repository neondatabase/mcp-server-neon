import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const SPEND_CAP_RESULT_SCHEMA = z.looseObject({
  spending_limit_cents: z.int().nullable(),
  spend_cap_enabled: z.boolean().nullish(),
  current_usage_cents: z.int().nullish(),
  usage_observed_at: z.string().nullish(),
  invoice_period_id: z.string().nullish(),
  status: z.string().nullish(),
  enforcement_status: z.string().nullish(),
  monitoring_delay: z.string().nullish(),
  warning: z.string().nullish(),
  notice: z.string(),
});

const usd = (cents: number | null | undefined): string => {
  if (cents === null || cents === undefined) {
    return 'unavailable';
  }

  const exact = String(cents).padStart(3, '0');

  return `$${exact.slice(0, -2)}.${exact.slice(-2)}`;
};

/** Host presentation; the package owns the API contract and operational notices. */
export const spendCapToolResult = (
  value: z.infer<typeof SPEND_CAP_RESULT_SCHEMA>,
): CallToolResult => {
  const setting = value.spend_cap_enabled;

  let mode = 'unavailable or unsupported';

  if (setting !== null && setting !== undefined) {
    mode = setting ? 'enabled' : 'disabled (email notifications only)';
  }

  const text = [
    `Monthly notification threshold: ${value.spending_limit_cents === null ? 'not configured' : usd(value.spending_limit_cents)}`,
    `Suspension opt-in: ${mode}`,
    `Observed current-invoice usage: ${usd(value.current_usage_cents)}`,
    `Usage observed at: ${value.usage_observed_at ?? 'unavailable'}`,
    `Current invoice period: ${value.invoice_period_id ?? 'unavailable'}`,
    `Spending limit status: ${value.status ?? 'unavailable'}`,
    `Enforcement acknowledgement: ${value.enforcement_status ?? 'unavailable'}`,
    `Monitoring delay: ${value.monitoring_delay ?? 'unavailable (normally 1-2 hours)'}`,
    value.notice,
  ];

  if (
    value.warning !== null &&
    value.warning !== undefined &&
    value.warning !== ''
  ) {
    text.push(`Warning: ${value.warning}`);
  }

  return {
    content: [
      { type: 'text', text: text.join('\n') },
      { type: 'text', text: JSON.stringify(value, null, 2) },
    ],
  };
};
