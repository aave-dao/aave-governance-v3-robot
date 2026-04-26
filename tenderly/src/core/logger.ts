export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  trace(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/** Single log record passed to a formatter. Lets the CLI add ANSI colors without the core
 * having to know anything about terminal output. */
export type LogRecord = {
  level: LogLevel;
  message: string;
  /** Bindings merged with per-call meta, ready to render. */
  meta: Record<string, unknown>;
  /** ISO 8601 timestamp string. */
  timestamp: string;
};

export type LogFormatter = (record: LogRecord) => string;

const LEVEL_RANK: Record<LogLevel, number> = { trace: 5, debug: 10, info: 20, warn: 30, error: 40 };

const fmtMeta = (meta: Record<string, unknown>): string => {
  if (Object.keys(meta).length === 0) return '';
  const stringified = Object.entries(meta)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return ` ${stringified}`;
};

/** Default plain formatter — used by Tenderly Actions where ANSI escapes would clutter logs. */
export const plainFormatter: LogFormatter = ({ level, message, meta, timestamp }) =>
  `[${timestamp}] ${level.toUpperCase()} ${message}${fmtMeta(meta)}`;

class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly bindings: Record<string, unknown> = {},
    private readonly sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
    private readonly formatter: LogFormatter = plainFormatter,
  ) {}

  private emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const merged = { ...this.bindings, ...(meta ?? {}) };
    this.sink(this.formatter({ level, message: msg, meta: merged, timestamp: new Date().toISOString() }));
  }

  trace(msg: string, meta?: Record<string, unknown>) { this.emit('trace', msg, meta); }
  debug(msg: string, meta?: Record<string, unknown>) { this.emit('debug', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>) { this.emit('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>) { this.emit('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.emit('error', msg, meta); }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(
      this.minLevel,
      { ...this.bindings, ...bindings },
      this.sink,
      this.formatter,
    );
  }
}

export const createLogger = (
  level: LogLevel = 'info',
  sink?: (line: string) => void,
  formatter: LogFormatter = plainFormatter,
): Logger => new ConsoleLogger(level, {}, sink, formatter);
