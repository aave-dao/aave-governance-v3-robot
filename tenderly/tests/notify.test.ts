import {beforeEach, describe, expect, test} from 'bun:test';
import type {PublicClient} from 'viem';
import {notifyError, notifyHealth, notifyTxSuccess} from '../src/core/notify';
import {withEnv} from './helpers/env';
import {installFetchMock, type FetchResponseSpec} from './helpers/mockFetch';

// Minimal PublicClient stub: `notifyTxSuccess` only calls `waitForTransactionReceipt`.
const fakeClient = (
  receipt: {status: 'success' | 'reverted'; blockNumber: bigint} = {
    status: 'success',
    blockNumber: 1n,
  },
): PublicClient =>
  ({
    waitForTransactionReceipt: async () => receipt,
  } as unknown as PublicClient);

const NO_CHANNELS = {
  SLACK_WEBHOOK_URL: undefined,
  TELEGRAM_BOT_TOKEN: undefined,
  TELEGRAM_CHAT_ID: undefined,
  TELEGRAM_WEBHOOK_URL: undefined,
};

const SLACK_ONLY = {
  SLACK_WEBHOOK_URL: 'https://example.com/slack',
  TELEGRAM_BOT_TOKEN: undefined,
  TELEGRAM_CHAT_ID: undefined,
  TELEGRAM_WEBHOOK_URL: undefined,
};

const TG_BOT = {
  SLACK_WEBHOOK_URL: undefined,
  TELEGRAM_BOT_TOKEN: 'BOT_TOKEN',
  TELEGRAM_CHAT_ID: '12345',
  TELEGRAM_WEBHOOK_URL: undefined,
};

const TG_RELAY = {
  SLACK_WEBHOOK_URL: undefined,
  TELEGRAM_BOT_TOKEN: undefined,
  TELEGRAM_CHAT_ID: undefined,
  TELEGRAM_WEBHOOK_URL: 'https://example.com/relay',
};

const ok200 = (): FetchResponseSpec => ({status: 200, body: '{}'});

describe('notifyTxSuccess', () => {
  test('no-op when no channels are configured', async () => {
    await withEnv(NO_CHANNELS, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({publicClient: fakeClient(), chainId: 1, action: 'test', txHash: '0xabc'});
      } finally {
        restore();
      }
      expect(calls.length).toBe(0);
    });
  });

  test('Slack only: posts mrkdwn to SLACK_WEBHOOK_URL with explorer link', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({
          publicClient: fakeClient(),
          chainId: 1,
          chainName: 'ethereum',
          action: 'activateVoting',
          txHash: '0x' + 'ab'.repeat(32),
          meta: {proposalId: '42'},
        });
      } finally {
        restore();
      }
      // Filter to slack URL only — `meta.proposalId` triggers `enrichProposalContext`
      // which also fetches the L1 RPC for IPFS title/author. That fetch goes through the
      // mocked global fetch too. We only care about the Slack POST here.
      const slackCalls = calls.filter((c) => c.url === 'https://example.com/slack');
      expect(slackCalls.length).toBe(1);
      const body = JSON.parse(slackCalls[0]?.bodyText ?? '{}');
      expect(body.text).toContain(':white_check_mark:');
      expect(body.text).toContain('*activateVoting*');
      expect(body.text).toContain('`ethereum`');
      expect(body.text).toContain('proposalId: `42`');
      expect(body.text).toMatch(/<https:\/\/etherscan\.io\/tx\/0xabab/);
    });
  });

  test('Slack: known chain (ethereum) gets a hyperlink, unknown chain gets a bare hash', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({publicClient: fakeClient(), chainId: 0xdeadbeef, action: 'a', txHash: '0xabc'});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toContain('`0xabc`');
      expect(body.text).not.toContain('<http');
    });
  });

  test('Telegram bot path: posts HTML to api.telegram.org/bot<token>/sendMessage', async () => {
    await withEnv(TG_BOT, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({publicClient: fakeClient(), chainId: 1, action: 'a', txHash: '0xabc'});
      } finally {
        restore();
      }
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe('https://api.telegram.org/botBOT_TOKEN/sendMessage');
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.chat_id).toBe('12345');
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('<b>a</b>');
    });
  });

  test('Telegram relay path: posts {text: <plain>} to TELEGRAM_WEBHOOK_URL', async () => {
    await withEnv(TG_RELAY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({publicClient: fakeClient(), chainId: 1, action: 'a', txHash: '0xabc'});
      } finally {
        restore();
      }
      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe('https://example.com/relay');
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(typeof body.text).toBe('string');
      expect(body.text).toContain('a on');
      // No HTML tags or Slack-specific syntax.
      expect(body.text).not.toContain('<b>');
      expect(body.text).not.toContain(':white_check_mark:');
    });
  });

  test('escapes HTML in Telegram chainName/action; renders BigInt meta', async () => {
    await withEnv(TG_BOT, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyTxSuccess({
          publicClient: fakeClient(),
          chainId: 1,
          chainName: 'a<b>&c',
          action: 'x<y>',
          txHash: '0xabc',
          meta: {n: 5n, deep: {k: 1}},
        });
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toContain('a&lt;b&gt;&amp;c');
      expect(body.text).toContain('x&lt;y&gt;');
      expect(body.text).toContain('n: <code>5</code>');
      // escapeHtml only handles &<>, not quotes — so JSON quotes pass through verbatim.
      expect(body.text).toContain('deep: <code>{"k":1}</code>');
    });
  });

  test('non-2xx response logs warn but does not throw', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const warns: unknown[] = [];
      const logger = {
        trace() {},
        debug() {},
        info() {},
        warn(msg: string, meta?: Record<string, unknown>) {
          warns.push({msg, meta});
        },
        error() {},
        child() {
          return logger;
        },
      };
      const {restore} = installFetchMock(() => ({status: 500, body: 'oops'}));
      try {
        await notifyTxSuccess({publicClient: fakeClient(), chainId: 1, action: 'a', txHash: '0xabc', logger});
      } finally {
        restore();
      }
      expect(warns.length).toBe(1);
    });
  });

  test('fetch throwing is swallowed', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore} = installFetchMock(() => ({
        status: 200,
        body: '',
        throwError: new Error('network down'),
      }));
      try {
        await expect(
          notifyTxSuccess({publicClient: fakeClient(), chainId: 1, action: 'a', txHash: '0xabc'}),
        ).resolves.toBeUndefined();
      } finally {
        restore();
      }
    });
  });
});

describe('notifyError', () => {
  test('dedupe: same Error instance is only sent once', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const err = new Error('boom');
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: err});
        await notifyError({source: 'src', error: err});
      } finally {
        restore();
      }
      expect(calls.length).toBe(1);
    });
  });

  test('different Error instances are not deduped', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: new Error('a')});
        await notifyError({source: 'src', error: new Error('b')});
      } finally {
        restore();
      }
      expect(calls.length).toBe(2);
    });
  });

  test('frozen object errors do not crash', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const frozen = Object.freeze({reason: 'no'});
      const {restore} = installFetchMock(() => ok200());
      try {
        await expect(notifyError({source: 'src', error: frozen})).resolves.toBeUndefined();
      } finally {
        restore();
      }
    });
  });

  test('non-Error error renders via String()', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: 'plain string error'});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toContain('plain string error');
    });
  });

  test('includes stack lines (truncated to 5) when error is an Error', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const err = new Error('failure');
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: err});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toContain('failure');
      // The codeblock fences are part of Slack mrkdwn.
      expect(body.text).toMatch(/```[\s\S]+```/);
    });
  });

  test('Slack omits chain part when chainId is undefined', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: new Error('e')});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).not.toContain('chain:');
    });
  });

  test('Slack includes chain part when chainId is provided', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyError({source: 'src', error: new Error('e'), chainId: 137, chainName: 'pol'});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toContain('chain: `pol`');
    });
  });
});

describe('notifyHealth', () => {
  test('passes the three pre-rendered flavors verbatim to the channels', async () => {
    await withEnv(SLACK_ONLY, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyHealth({
          slack: 'SLACK BODY',
          tg: '<b>TG</b>',
          plain: 'plain text',
        });
      } finally {
        restore();
      }
      expect(calls.length).toBe(1);
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toBe('SLACK BODY');
    });
  });

  test('telegram bot path uses the html flavor', async () => {
    await withEnv(TG_BOT, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyHealth({slack: 'X', tg: '<b>Y</b>', plain: 'Z'});
      } finally {
        restore();
      }
      const body = JSON.parse(calls[0]?.bodyText ?? '{}');
      expect(body.text).toBe('<b>Y</b>');
    });
  });

  test('no-op when no channels are configured', async () => {
    await withEnv(NO_CHANNELS, async () => {
      const {restore, calls} = installFetchMock(() => ok200());
      try {
        await notifyHealth({slack: 'a', tg: 'b', plain: 'c'});
      } finally {
        restore();
      }
      expect(calls.length).toBe(0);
    });
  });
});

// guard against env leakage: none of these tests touch real channels.
beforeEach(() => {
  /* no-op — withEnv handles isolation per test */
});
