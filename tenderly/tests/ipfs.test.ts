import {describe, expect, test} from 'bun:test';
import {
  fetchIpfsText,
  fetchProposalMetadata,
  fetchProposalMetadataSafe,
  ipfsHashToCidV0,
  parseProposalMarkdown,
} from '../src/core/ipfs';
import {installFetchMock} from './helpers/mockFetch';

describe('ipfsHashToCidV0', () => {
  test('all-zero hash → known CIDv0 (with leading 1s for zero bytes)', () => {
    const cid = ipfsHashToCidV0(('0x' + '00'.repeat(32)) as `0x${string}`);
    expect(cid).toBe('QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51');
  });

  test('all-0xff hash → known CIDv0', () => {
    const cid = ipfsHashToCidV0(('0x' + 'ff'.repeat(32)) as `0x${string}`);
    expect(cid).toBe('QmfZy5bvk7a3DQAjCbGNtmrPXWkyVvPrdnZMyBZ5q5ieKG');
  });

  test('mixed hash → known CIDv0', () => {
    const cid = ipfsHashToCidV0(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as `0x${string}`,
    );
    expect(cid).toBe('QmNR6K15azWjGnvqaqHJPrpx1g7KSeVRKy1cjFPFwmvkGv');
  });

  test('CIDv0 always starts with Qm', () => {
    expect(ipfsHashToCidV0(('0x' + '01'.repeat(32)) as `0x${string}`)).toMatch(/^Qm/);
  });

  test('throws when input is not 32 bytes', () => {
    expect(() => ipfsHashToCidV0('0x1234' as `0x${string}`)).toThrow(/32 bytes/);
  });

  test('handles input without 0x prefix', () => {
    const withPrefix = ipfsHashToCidV0(('0x' + '12'.repeat(32)) as `0x${string}`);
    const withoutPrefix = ipfsHashToCidV0(('12'.repeat(32)) as `0x${string}`);
    expect(withPrefix).toBe(withoutPrefix);
  });
});

describe('parseProposalMarkdown', () => {
  test('parses full frontmatter (title, author, discussions, shortDescription, body)', () => {
    const raw = [
      '---',
      'title: My Proposal',
      'author: BGD Labs',
      'discussions: https://governance.aave.com/x',
      'shortDescription: A short summary',
      '---',
      '# Body heading',
      '',
      'Body content.',
    ].join('\n');
    const meta = parseProposalMarkdown(raw);
    expect(meta.title).toBe('My Proposal');
    expect(meta.author).toBe('BGD Labs');
    expect(meta.discussions).toBe('https://governance.aave.com/x');
    expect(meta.shortDescription).toBe('A short summary');
    expect(meta.body).toContain('# Body heading');
    expect(meta.raw).toBe(raw);
  });

  test('strips matching single quotes', () => {
    const raw = "---\ntitle: 'quoted'\n---\n";
    expect(parseProposalMarkdown(raw).title).toBe('quoted');
  });

  test('strips matching double quotes', () => {
    const raw = '---\ntitle: "quoted"\n---\n';
    expect(parseProposalMarkdown(raw).title).toBe('quoted');
  });

  test('leaves mismatched quotes intact', () => {
    const raw = '---\ntitle: \'mismatch"\n---\n';
    expect(parseProposalMarkdown(raw).title).toBe('\'mismatch"');
  });

  test('summary alias maps to shortDescription', () => {
    const raw = '---\nsummary: alt\n---\n';
    expect(parseProposalMarkdown(raw).shortDescription).toBe('alt');
  });

  test('short-description alias maps to shortDescription', () => {
    const raw = '---\nshort-description: alt\n---\n';
    expect(parseProposalMarkdown(raw).shortDescription).toBe('alt');
  });

  test('no frontmatter → all fields undefined, body equals raw', () => {
    const raw = 'no frontmatter at all';
    const meta = parseProposalMarkdown(raw);
    expect(meta.title).toBeUndefined();
    expect(meta.author).toBeUndefined();
    expect(meta.body).toBe(raw);
    expect(meta.raw).toBe(raw);
  });

  test('malformed frontmatter (missing closing ---) treated as no-frontmatter', () => {
    const raw = '---\ntitle: oops\nbody continues';
    const meta = parseProposalMarkdown(raw);
    expect(meta.title).toBeUndefined();
    expect(meta.body).toBe(raw);
  });

  test('multi-line continuation overwrites the kv value with the joined continuation', () => {
    // The parser is built for empty kv lines (`title:\n  continuation`); when the kv line
    // already carries a value, continuation lines REPLACE it. This documents that behavior.
    const raw = '---\ntitle:\n  line one\n  line two\n---\n';
    expect(parseProposalMarkdown(raw).title).toBe('line one line two');
  });

  test('list-style continuation entries are joined and strip leading - / *', () => {
    const raw = '---\nauthor:\n  - Second Author\n  - Third Author\n---\n';
    const meta = parseProposalMarkdown(raw);
    expect(meta.author).toBe('Second Author Third Author');
  });

  test('body is the markdown after the closing ---', () => {
    const raw = '---\ntitle: t\n---\n\n## Heading\n\ntext';
    expect(parseProposalMarkdown(raw).body.trim()).toBe('## Heading\n\ntext');
  });
});

describe('fetchIpfsText', () => {
  test('returns text from the first successful gateway, skipping failures', async () => {
    const calls: string[] = [];
    const {restore} = installFetchMock((url) => {
      calls.push(url);
      if (url.startsWith('https://cloudflare-ipfs.com')) return {status: 500, body: ''};
      if (url.startsWith('https://ipfs.io')) return {status: 200, body: 'hello-from-ipfs.io'};
      return {status: 404, body: ''};
    });
    try {
      const text = await fetchIpfsText('QmTest');
      expect(text).toBe('hello-from-ipfs.io');
      expect(calls.length).toBe(2);
      expect(calls[1]).toContain('ipfs.io/ipfs/QmTest');
    } finally {
      restore();
    }
  });

  test('throws when every gateway fails', async () => {
    const {restore} = installFetchMock((url) => {
      if (url.startsWith('https://cloudflare-ipfs.com')) {
        return {status: 200, body: '', throwError: new Error('net 1')};
      }
      return {status: 404, body: ''};
    });
    try {
      await expect(fetchIpfsText('QmFails')).rejects.toThrow();
    } finally {
      restore();
    }
  });

  test('respects custom gateway list', async () => {
    const seen: string[] = [];
    const {restore} = installFetchMock((url) => {
      seen.push(url);
      return {status: 200, body: 'custom'};
    });
    try {
      const text = await fetchIpfsText('Qm1', {gateways: ['https://only.example/ipfs']});
      expect(text).toBe('custom');
      expect(seen).toEqual(['https://only.example/ipfs/Qm1']);
    } finally {
      restore();
    }
  });
});

describe('fetchProposalMetadata / fetchProposalMetadataSafe', () => {
  const HASH = ('0x' + '12'.repeat(32)) as `0x${string}`;

  test('fetchProposalMetadata: success → parsed metadata', async () => {
    const {restore} = installFetchMock(() => ({
      status: 200,
      body: '---\ntitle: T\n---\n\nbody',
    }));
    try {
      const meta = await fetchProposalMetadata(HASH);
      expect(meta.title).toBe('T');
      expect(meta.body.trim()).toBe('body');
    } finally {
      restore();
    }
  });

  test('fetchProposalMetadata: all gateways fail → throws', async () => {
    const {restore} = installFetchMock(() => ({status: 500, body: ''}));
    try {
      await expect(fetchProposalMetadata(HASH)).rejects.toThrow();
    } finally {
      restore();
    }
  });

  test('fetchProposalMetadataSafe: failure → undefined', async () => {
    const {restore} = installFetchMock(() => ({status: 500, body: ''}));
    try {
      expect(await fetchProposalMetadataSafe(HASH)).toBeUndefined();
    } finally {
      restore();
    }
  });

  test('fetchProposalMetadataSafe: success → parsed metadata', async () => {
    const {restore} = installFetchMock(() => ({
      status: 200,
      body: '---\ntitle: ok\n---\n',
    }));
    try {
      const m = await fetchProposalMetadataSafe(HASH);
      expect(m?.title).toBe('ok');
    } finally {
      restore();
    }
  });
});
