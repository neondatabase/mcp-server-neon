/**
 * API objects with every field the Neon API spec marks required, for loopback
 * servers whose responses reach a tool's output schema check.
 */

const TIMESTAMP = '2026-01-01T00:00:00Z';

export const neonProject = (fields: { id: string; name?: string }) => ({
  data_storage_bytes_hour: 0,
  data_transfer_bytes: 0,
  written_data_bytes: 0,
  compute_time_seconds: 0,
  active_time_seconds: 0,
  cpu_used_sec: 0,
  platform_id: 'aws',
  region_id: 'aws-us-east-2',
  name: fields.id,
  provisioner: 'k8s-neonvm',
  pg_version: 17,
  proxy_host: 'us-east-2.aws.neon.tech',
  branch_logical_size_limit: 0,
  branch_logical_size_limit_bytes: 0,
  store_passwords: true,
  creation_source: 'console',
  history_retention_seconds: 86_400,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  consumption_period_start: TIMESTAMP,
  consumption_period_end: TIMESTAMP,
  owner_id: 'owner-id',
  ...fields,
});

export const neonBranch = (fields: {
  id: string;
  project_id: string;
  name?: string;
  parent_id?: string;
}) => ({
  name: fields.id,
  current_state: 'ready',
  state_changed_at: TIMESTAMP,
  creation_source: 'console',
  default: false,
  protected: false,
  cpu_used_sec: 0,
  compute_time_seconds: 0,
  active_time_seconds: 0,
  written_data_bytes: 0,
  data_transfer_bytes: 0,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  ...fields,
});
