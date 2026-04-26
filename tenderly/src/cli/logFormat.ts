import type { LogFormatter, LogLevel } from '../core/logger';
import { c } from './colors';

/**
 * Color scheme — chosen to make scanning a verbose log easy:
 *   - timestamp dimmed (we rarely care about ms-precision when reading interactively)
 *   - level coloured by severity
 *   - message bold-ish at info+ to draw the eye, dim at trace/debug to recede
 *   - meta keys gray, values default — keys repeat a lot, values are the new info
 */
const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: c.gray('TRACE'),
  debug: c.cyan('DEBUG'),
  info: c.green(' INFO'),
  warn: c.yellow(' WARN'),
  error: c.red('ERROR'),
};

const styleMessage = (level: LogLevel, msg: string): string => {
  switch (level) {
    case 'trace':
    case 'debug':
      return c.dim(msg);
    case 'info':
      return msg;
    case 'warn':
      return c.yellow(msg);
    case 'error':
      return c.red(msg);
  }
};

/** Render the meta record as `key=value key=value …` with greyed-out keys. */
const styleMeta = (meta: Record<string, unknown>): string => {
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';
  return (
    ' ' +
    keys
      .map((k) => {
        const raw = meta[k];
        const val = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
        return `${c.gray(k + '=')}${val}`;
      })
      .join(' ')
  );
};

/** Strip the `T` and trailing `Z` for compactness; full ISO is overkill in interactive use. */
const compactTime = (iso: string): string => iso.slice(11, 23); // HH:mm:ss.SSS

export const colorFormatter: LogFormatter = ({ level, message, meta, timestamp }) =>
  `${c.dim(compactTime(timestamp))} ${LEVEL_LABEL[level]} ${styleMessage(level, message)}${styleMeta(meta)}`;
