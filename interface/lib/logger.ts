import 'server-only';
import { createLogger, type LogLevel, type Logger } from '@robot/core/logger';
import { loadServerEnv } from './env';

let cachedLogger: Logger | undefined;

export const getLogger = (): Logger => {
  if (cachedLogger) return cachedLogger;
  const level = (loadServerEnv().LOG_LEVEL as LogLevel) ?? 'info';
  cachedLogger = createLogger(level);
  return cachedLogger;
};
