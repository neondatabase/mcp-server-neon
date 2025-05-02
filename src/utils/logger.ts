import winston from 'winston';
import morgan from 'morgan';
import { Request, Response, NextFunction } from 'express';

const loggerFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.simple(),
  winston.format.errors({ stack: true }),
  winston.format.align(),
  winston.format.colorize(),
);
// Configure Winston logger
export const logger = winston.createLogger({
  level: 'info',
  format: loggerFormat,
  transports: [
    new winston.transports.Console({
      format: loggerFormat,
    }),
  ],
});

// Configure Morgan for HTTP request logging
export const morganConfig = morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim()),
  },
});

// Configure error handling middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error('Error:', { error: err.message, stack: err.stack });
  next(err);
};
