import {describe, expect, test} from 'bun:test';
import {createLogger, plainFormatter, type LogRecord} from '../src/core/logger';

const captureSink = () => {
  const lines: string[] = [];
  return {sink: (line: string) => lines.push(line), lines};
};

describe('Logger', () => {
  test('info logger swallows debug and trace, emits info+', () => {
    const {sink, lines} = captureSink();
    const log = createLogger('info', sink);
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('INFO i');
    expect(lines[1]).toContain('WARN w');
    expect(lines[2]).toContain('ERROR e');
  });

  test('trace logger emits everything', () => {
    const {sink, lines} = captureSink();
    const log = createLogger('trace', sink);
    log.trace('a');
    log.debug('b');
    log.info('c');
    log.warn('d');
    log.error('e');
    expect(lines.length).toBe(5);
  });

  test('error level only emits errors', () => {
    const {sink, lines} = captureSink();
    const log = createLogger('error', sink);
    log.info('skip');
    log.warn('skip');
    log.error('keep');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('ERROR keep');
  });

  test('child() merges bindings with per-call meta', () => {
    const records: LogRecord[] = [];
    const sink = () => {
      /* discarded — we capture via formatter */
    };
    const formatter = (r: LogRecord) => {
      records.push(r);
      return '';
    };
    const log = createLogger('debug', sink, formatter);
    log.child({chain: 'eth'}).info('msg', {n: 1});
    expect(records[0]?.meta).toEqual({chain: 'eth', n: 1});
    expect(records[0]?.level).toBe('info');
    expect(records[0]?.message).toBe('msg');
  });

  test('nested child() merges left-to-right with later keys winning', () => {
    const records: LogRecord[] = [];
    const formatter = (r: LogRecord) => {
      records.push(r);
      return '';
    };
    const log = createLogger('debug', () => {}, formatter);
    log.child({a: 1, b: 2}).child({b: 99}).info('m');
    expect(records[0]?.meta).toEqual({a: 1, b: 99});
  });

  test('formatter receives an ISO timestamp', () => {
    const records: LogRecord[] = [];
    const formatter = (r: LogRecord) => {
      records.push(r);
      return '';
    };
    const log = createLogger('debug', () => {}, formatter);
    log.info('m');
    expect(records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('plainFormatter', () => {
  test('produces "[ts] LEVEL message k=v"', () => {
    const out = plainFormatter({
      level: 'info',
      message: 'hello',
      meta: {n: 1, s: 'x'},
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(out).toBe('[2024-01-01T00:00:00.000Z] INFO hello n=1 s=x');
  });

  test('renders empty meta without trailing space', () => {
    const out = plainFormatter({
      level: 'warn',
      message: 'm',
      meta: {},
      timestamp: 'T',
    });
    expect(out).toBe('[T] WARN m');
  });

  test('JSON-stringifies object meta values', () => {
    const out = plainFormatter({
      level: 'info',
      message: 'm',
      meta: {x: {a: 1}},
      timestamp: 'T',
    });
    expect(out).toBe('[T] INFO m x={"a":1}');
  });
});
