import {describe, expect, test} from 'bun:test';
import type {Hex} from 'viem';
import {
  backupProposalOnCreated,
  backupToProviders,
  filebaseGatewayUrl,
  pinataGatewayUrl,
  renderBackupSummary,
  type ProviderBackupResult,
} from '../src/core/proposalBackup';
import type {BackupProvider} from '../src/core/providers';
import type {ProposalCidGroup} from '../src/core/ipfsMigration';
import {silentLogger} from './helpers/mockClient';

const CID = 'Qmf7DQqMY1L5wpW3KymVxBJQcB7AensPWqeYQUmfZPt5F1';

const mockProvider = (
  name: string,
  o: {backed?: boolean; backupStatus?: 'backed' | 'pending' | 'failed'; reason?: string} = {},
): BackupProvider => ({
  name,
  needsContent: false,
  isBacked: async () => !!o.backed,
  backup: async () => ({status: o.backupStatus ?? 'backed', method: 'x', reason: o.reason}),
  verify: async () => true,
  unpin: async () => ({status: o.backed ? 'unpinned' : 'not-present'}),
});

describe('gateway URL helpers', () => {
  test('filebase uses the shared public gateway', () => {
    expect(filebaseGatewayUrl(CID)).toBe(`https://ipfs.filebase.io/ipfs/${CID}`);
  });

  test('pinata uses the dedicated gateway when configured', () => {
    expect(pinataGatewayUrl(CID, {PINATA_GATEWAY: 'my-gw.mypinata.cloud'} as never)).toBe(
      `https://my-gw.mypinata.cloud/ipfs/${CID}`,
    );
  });

  test('pinata falls back to the public gateway when unset', () => {
    expect(pinataGatewayUrl(CID, {} as never)).toBe(`https://gateway.pinata.cloud/ipfs/${CID}`);
  });

  test('pinata dedicated gateway tolerates a scheme/trailing slash', () => {
    expect(pinataGatewayUrl(CID, {PINATA_GATEWAY: 'https://g.mypinata.cloud/'} as never)).toBe(
      `https://g.mypinata.cloud/ipfs/${CID}`,
    );
  });
});

describe('renderBackupSummary', () => {
  const results: ProviderBackupResult[] = [
    {provider: 'pinata', status: 'already-pinned', gatewayUrl: `https://gw/ipfs/${CID}`},
    {provider: 'filebase', status: 'pinned', gatewayUrl: `https://ipfs.filebase.io/ipfs/${CID}`},
  ];

  test('slack: provider names are gateway hyperlinks with the right verbs', () => {
    const {slack} = renderBackupSummary(487n, CID, results);
    expect(slack).toContain('proposal #487');
    expect(slack).toContain(`already on <https://gw/ipfs/${CID}|Pinata>`);
    expect(slack).toContain(`pinned on <https://ipfs.filebase.io/ipfs/${CID}|Filebase>`);
  });

  test('telegram: HTML anchors', () => {
    const {tg} = renderBackupSummary(487n, CID, results);
    expect(tg).toContain(`<a href="https://ipfs.filebase.io/ipfs/${CID}">Filebase</a>`);
    expect(tg).toContain('already on <a href=');
  });

  test('plain: gateway URLs inline', () => {
    const {plain} = renderBackupSummary(487n, CID, results);
    expect(plain).toContain(`Pinata: https://gw/ipfs/${CID}`);
    expect(plain).toContain(`Filebase: https://ipfs.filebase.io/ipfs/${CID}`);
  });

  test('failed provider: no hyperlink, reason shown', () => {
    const {slack, tg} = renderBackupSummary(1n, CID, [
      {provider: 'filebase', status: 'failed', gatewayUrl: 'x', reason: 'boom'},
    ]);
    expect(slack).toContain('failed on Filebase (boom)');
    expect(slack).not.toContain('<x|Filebase>');
    expect(tg).toContain('failed on Filebase (boom)');
  });

  test('pending provider: shows "queued on"', () => {
    const {slack} = renderBackupSummary(1n, CID, [
      {provider: 'pinata', status: 'pending', gatewayUrl: `https://gw/ipfs/${CID}`},
    ]);
    expect(slack).toContain(`queued on <https://gw/ipfs/${CID}|Pinata>`);
  });
});

describe('backupToProviders', () => {
  const group: ProposalCidGroup = {
    cid: CID,
    ipfsHash: ('0x' + 'ab'.repeat(32)) as Hex,
    proposalIds: [7n],
  };

  test('runs every provider and maps status + gateway url', async () => {
    const providers = [
      mockProvider('pinata', {backed: true}), // already pinned
      mockProvider('filebase', {backupStatus: 'backed'}), // freshly backed
    ];
    const results = await backupToProviders(providers, group, silentLogger);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({provider: 'pinata', status: 'already-pinned'});
    expect(results[1]).toMatchObject({provider: 'filebase', status: 'pinned'});
    expect(results[1]!.gatewayUrl).toBe(`https://ipfs.filebase.io/ipfs/${CID}`);
  });

  test('a provider returning failed surfaces as failed (never throws)', async () => {
    const providers = [mockProvider('filebase', {backupStatus: 'failed', reason: 'x'})];
    const results = await backupToProviders(providers, group, silentLogger);
    expect(results[0]!.status).toBe('failed');
  });
});

describe('backupProposalOnCreated', () => {
  test('zero / missing ipfsHash → skipped (null), no throw', async () => {
    const zero = ('0x' + '00'.repeat(32)) as Hex;
    expect(
      await backupProposalOnCreated({proposalId: 1n, ipfsHash: zero, logger: silentLogger}),
    ).toBeNull();
  });
});
