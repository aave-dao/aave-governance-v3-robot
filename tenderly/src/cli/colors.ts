/**
 * Tiny ANSI color helper. We avoid the `chalk` dep because it's overkill here and
 * it has a long history of compatibility quirks with bun. Auto-disables when stdout
 * is not a TTY (e.g. piped to a file) or when `NO_COLOR=1`.
 */

const ENABLED =
  process.env.NO_COLOR !== '1' &&
  process.env.NO_COLOR !== 'true' &&
  Boolean((process.stdout as { isTTY?: boolean }).isTTY);

const wrap = (open: string, close: string) =>
  (s: string | number) => (ENABLED ? `${open}${s}${close}` : `${s}`);

export const c = {
  reset: '\x1b[0m',
  bold: wrap('\x1b[1m', '\x1b[22m'),
  dim: wrap('\x1b[2m', '\x1b[22m'),
  italic: wrap('\x1b[3m', '\x1b[23m'),
  underline: wrap('\x1b[4m', '\x1b[24m'),
  red: wrap('\x1b[31m', '\x1b[39m'),
  green: wrap('\x1b[32m', '\x1b[39m'),
  yellow: wrap('\x1b[33m', '\x1b[39m'),
  blue: wrap('\x1b[34m', '\x1b[39m'),
  magenta: wrap('\x1b[35m', '\x1b[39m'),
  cyan: wrap('\x1b[36m', '\x1b[39m'),
  gray: wrap('\x1b[90m', '\x1b[39m'),
};

/**
 * Status glyphs for the inspector. `ready` is the actionable item (highlighted),
 * `done` is success (green check), `blocked` is a soft "skip" (gray ✗ + reason).
 */
export const glyph = {
  ready: c.yellow('→'),
  done: c.green('✓'),
  blocked: c.gray('✗'),
  warn: c.yellow('⚠'),
  bullet: c.gray('•'),
};
