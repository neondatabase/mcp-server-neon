import winston from 'winston';

const loggerFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.simple(),
  winston.format.errors({ stack: true }),
  winston.format.align(),
  winston.format.colorize(),
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: loggerFormat,
  transports: [
    new winston.transports.Console({
      format: loggerFormat,
    }),
  ],
});
