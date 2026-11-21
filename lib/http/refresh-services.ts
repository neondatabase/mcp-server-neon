import { Layer } from 'effect';
import { RefreshInflight } from '../../mcp/oauth/refresh-inflight';
import { RefreshLock } from '../../mcp/oauth/refresh-lock-service';
import { RefreshRotations } from '../../mcp/oauth/refresh-rotations';
import { UpstreamOAuth } from '../oauth/upstream-oauth';

/** The services the refresh_token grant of /api/token runs on. */
export const RefreshServices = Layer.mergeAll(
  RefreshLock.layer,
  RefreshRotations.layer,
  RefreshInflight.layer,
  UpstreamOAuth.layer,
);
