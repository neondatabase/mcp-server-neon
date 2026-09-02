import { setTags, setUser } from '@sentry/node';
import { ServerContext } from '../types/context';
import type { IdentifiedClient } from '../utils/client-application';

export function agentSentryTags(agent: IdentifiedClient): {
  'client.agent': string;
  'client.application': IdentifiedClient['clientApplication'];
} {
  return {
    'client.agent': agent.clientName,
    'client.application': agent.clientApplication,
  };
}

export const setSentryTags = (
  context: ServerContext,
  agent: IdentifiedClient,
) => {
  setUser({
    id: context.account.id,
  });
  setTags({
    'app.name': context.app.name,
    'app.version': context.app.version,
    'app.transport': context.app.transport,
    'app.environment': context.app.environment,
    ...agentSentryTags(agent),
  });
  if (context.client) {
    setTags({
      'client.id': context.client.id,
      'client.name': context.client.name,
    });
  }
};
