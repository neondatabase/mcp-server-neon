import { Layer, Logger, References } from 'effect';
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
 * Log annotations become the winston metadata. Winston's `LOG_LEVEL` decides
 * what is printed, so Effect passes every level through.
 */
const winstonLogger = Logger.make(({ logLevel, message, fiber }) => {
  const text = Array.isArray(message)
    ? message.map(String).join(' ')
    : String(message);

  logger.log(WINSTON_LEVELS[logLevel], text, {
    ...fiber.getRef(References.CurrentLogAnnotations),
  });
});

export const WinstonLoggerLayer = Layer.merge(
  Logger.layer([winstonLogger]),
  Layer.succeed(References.MinimumLogLevel)('All'),
);
