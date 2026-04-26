export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const fmtMeta = (meta?: Record<string, unknown>): string => {
  if (!meta || Object.keys(meta).length === 0) return '';
  const stringified = Object.entries(meta)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
  return ` ${stringified}`;
};

class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly bindings: Record<string, unknown> = {},
    private readonly sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
  ) {}

  private emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const ts = new Date().toISOString();
    const merged = { ...this.bindings, ...meta };
    this.sink(`[${ts}] ${level.toUpperCase()} ${msg}${fmtMeta(merged)}`);
  }

  debug(msg: string, meta?: Record<string, unknown>) { this.emit('debug', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>) { this.emit('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>) { this.emit('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.emit('error', msg, meta); }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger(this.minLevel, { ...this.bindings, ...bindings }, this.sink);
  }
}

export const createLogger = (level: LogLevel = 'info', sink?: (line: string) => void): Logger =>
  new ConsoleLogger(level, {}, sink);
