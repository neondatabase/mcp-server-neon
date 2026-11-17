import {
  Cause,
  Inspectable,
  Layer,
  Logger,
  Predicate,
  References,
} from 'effect';
import type { LogLevel } from 'effect';
import { logger } from '../../mcp/utils/logger';

const WINSTON_LEVELS: Record<LogLevel.LogLevel, string> = {
  All: 'debug',
  Trace: 'debug',
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Fatal: 'error',
  None: 'error',
};

/**
 * Effect logs go to the winston logger, so they keep its console format and
 * reach Sentry Logs with the request's session attributes like every other log.
 * Log annotations become the winston metadata, and a logged cause its
 * `cause` field. Winston's `LOG_LEVEL` decides what is printed, so Effect
 * passes every level through.
 */
const winstonLogger = Logger.make(({ logLevel, message, cause, fiber }) => {
  const parts: readonly unknown[] = Array.isArray(message)
    ? message
    : [message];

  const text = parts
    .map((part) =>
      Predicate.isString(part) ? part : Inspectable.toStringUnknown(part, 0),
    )
    .join(' ');

  const annotations = fiber.getRef(References.CurrentLogAnnotations);
  const level = WINSTON_LEVELS[logLevel];

  if (cause.reasons.length === 0) {
    logger.log(level, text, annotations);

    return;
  }

  logger.log(level, text, { ...annotations, cause: Cause.pretty(cause) });
});

export const WinstonLoggerLayer = Layer.merge(
  Logger.layer([winstonLogger]),
  Layer.succeed(References.MinimumLogLevel)('All'),
);
