import { createSentryWinstonTransport } from '@sentry/node';
import winston from 'winston';
import Transport from 'winston-transport';
import { requestSessionAttributes } from '../sentry/session';

const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.simple(),
  winston.format.errors({ stack: true }),
  winston.format.align(),
  winston.format.colorize(),
);

const withRequestSession = winston.format((info) =>
  Object.assign(info, requestSessionAttributes()),
);

const SentryWinstonTransport = createSentryWinstonTransport(Transport);

// The console format stays on its transport: a logger-level format would
// reach Sentry too, where `align` prefixes every message with a tab.
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new SentryWinstonTransport({ format: withRequestSession() }),
  ],
});
