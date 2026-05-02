import {beforeAll, afterAll, describe, expect, test} from 'bun:test';
import {GovernanceV3Polygon} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {runVotingScan, scanVotingChain} from '../src/orchestration/votingScan';
import {VotingMachineProposalState} from '../src/core/state';
import {
  makeMockClient,
  makeMockWalletClient,
  makeWalletSpy,
  silentLogger,
  type Mocks,
} from './helpers/mockClient';

const VM = GovernanceV3Polygon.VOTING_MACHINE.toLowerCase();
const STRAT = GovernanceV3Polygon.VOTING_STRATEGY.toLowerCase();
const WAREHOUSE = GovernanceV3Polygon.DATA_WAREHOUSE.toLowerCase();
const ACCOUNT = ('0x' + '99'.repeat(20)) as Address;
const TX = ('0x' + 'cc'.repeat(32)) as Hex;
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const BLOCK_HASH = ('0x' + 'aa'.repeat(32)) as Hex;

const ORIGINAL_ENV = {...process.env};
beforeAll(() => {
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_WEBHOOK_URL;
});
afterAll(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL_ENV)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

type Page = bigint[];

const buildMocks = (
  pages: Page[],
  perId: Record<string, {state: number; voteConfig: {votingDuration: number; l1ProposalBlockHash: Hex}}>,
  rootChecks: Record<string, {hasRoots: boolean; govRoot: Hex}> = {},
): Mocks => ({
  // Pagination: each call to getProposalsVoteConfigurationIds(skip, size) returns the next page.
  // We don't bother keying by skip — just consume pages in order.
  [`${VM}.getProposalsVoteConfigurationIds`]: (() => {
    let idx = 0;
    return () => {
      const p = pages[idx] ?? [];
      idx += 1;
      return p;
    };
  })(),
  [`${VM}.getProposalState`]: (args: readonly unknown[]) =>
    perId[String(args[0])]?.state ?? VotingMachineProposalState.NotCreated,
  [`${VM}.getProposalVoteConfiguration`]: (args: readonly unknown[]) =>
    perId[String(args[0])]?.voteConfig ?? {votingDuration: 0, l1ProposalBlockHash: ZERO},
  [`${STRAT}.hasRequiredRoots`]: (args: readonly unknown[]) => {
    const blockHash = String(args[0]);
    // Find the matching proposal by its blockHash and look up rootChecks by id.
    const id = Object.entries(perId).find(
      ([, v]) => v.voteConfig.l1ProposalBlockHash === blockHash,
    )?.[0];
    if (!id) throw new Error('no roots');
    if (rootChecks[id]?.hasRoots) return undefined;
    throw new Error('roots not present');
  },
  [`${WAREHOUSE}.getStorageRoots`]: (args: readonly unknown[]) => {
    const blockHash = String(args[1]);
    const id = Object.entries(perId).find(
      ([, v]) => v.voteConfig.l1ProposalBlockHash === blockHash,
    )?.[0];
    if (!id) return ZERO;
    return rootChecks[id]?.govRoot ?? ZERO;
  },
});

describe('scanVotingChain', () => {
  test('returns [] when the first page is empty', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(buildMocks([[]], {}), {chainId: 137}),
    };
    expect(await scanVotingChain(ctx)).toEqual([]);
  });

  test('non-empty page with all Active proposals → no decisions, breaks loop', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[1n, 2n]],
          {
            '1': {
              state: VotingMachineProposalState.Active,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
            '2': {
              state: VotingMachineProposalState.Active,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
        ),
        {chainId: 137},
      ),
    };
    expect(await scanVotingChain(ctx)).toEqual([]);
  });

  test('Finished proposal → closeAndSendVote decision', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[5n], []],
          {
            '5': {
              state: VotingMachineProposalState.Finished,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
        ),
        {chainId: 137},
      ),
    };
    const out = await scanVotingChain(ctx);
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('closeAndSendVote');
    expect(out[0]?.proposalId).toBe(5n);
  });

  test('NotCreated with ZERO blockHash → skipped (vote config not bridged)', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[3n]],
          {
            '3': {
              state: VotingMachineProposalState.NotCreated,
              voteConfig: {votingDuration: 0, l1ProposalBlockHash: ZERO as Hex},
            },
          },
        ),
        {chainId: 137},
      ),
    };
    expect(await scanVotingChain(ctx)).toEqual([]);
  });

  test('NotCreated with blockHash + roots ready → createVote decision', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[7n], []],
          {
            '7': {
              state: VotingMachineProposalState.NotCreated,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
          {
            '7': {hasRoots: true, govRoot: ('0x' + 'cd'.repeat(32)) as Hex},
          },
        ),
        {chainId: 137},
      ),
    };
    const out = await scanVotingChain(ctx);
    expect(out[0]?.kind).toBe('createVote');
    expect(out[0]?.proposalId).toBe(7n);
  });

  test('NotCreated with blockHash but hasRequiredRoots reverts → submitStorageRoots', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[8n], []],
          {
            '8': {
              state: VotingMachineProposalState.NotCreated,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
          {'8': {hasRoots: false, govRoot: ZERO as Hex}},
        ),
        {chainId: 137},
      ),
    };
    const out = await scanVotingChain(ctx);
    expect(out[0]?.kind).toBe('submitStorageRoots');
    if (out[0]?.kind === 'submitStorageRoots') {
      expect(out[0].l1ProposalBlockHash).toBe(BLOCK_HASH);
    }
  });

  test('NotCreated with hasRequiredRoots success but govRoot ZERO → submitStorageRoots', async () => {
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[9n], []],
          {
            '9': {
              state: VotingMachineProposalState.NotCreated,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
          {'9': {hasRoots: true, govRoot: ZERO as Hex}},
        ),
        {chainId: 137},
      ),
    };
    const out = await scanVotingChain(ctx);
    expect(out[0]?.kind).toBe('submitStorageRoots');
  });

  test('pagination: stops after a page yields no actions', async () => {
    // Page 1 has a Finished item → 1 action collected; page 2 is empty → loop stops.
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[1n], []],
          {
            '1': {
              state: VotingMachineProposalState.Finished,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
        ),
        {chainId: 137},
      ),
    };
    const out = await scanVotingChain(ctx);
    expect(out.length).toBe(1);
  });

  test('throws when chainId is not a configured voting chain', async () => {
    const ctx = {chainId: 99999, logger: silentLogger, publicClient: makeMockClient({})};
    await expect(scanVotingChain(ctx)).rejects.toThrow(/not a voting chain/);
  });
});

describe('runVotingScan', () => {
  test('createVote branch: dispatches startProposalVote', async () => {
    const spy = makeWalletSpy(TX);
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[10n], []],
          {
            '10': {
              state: VotingMachineProposalState.NotCreated,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
          {'10': {hasRoots: true, govRoot: ('0x' + 'cd'.repeat(32)) as Hex}},
        ),
        {chainId: 137},
      ),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
      ethRpcUrls: 'https://l1.example.com',
    };
    const results = await runVotingScan(ctx);
    expect(results.length).toBe(1);
    expect(results[0]?.kind).toBe('createVote');
    expect(results[0]?.txHash).toBe(TX);
    expect(spy.calls[0]?.functionName).toBe('startProposalVote');
  });

  test('closeAndSendVote branch: dispatches closeAndSendVote', async () => {
    const spy = makeWalletSpy(TX);
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(
        buildMocks(
          [[11n], []],
          {
            '11': {
              state: VotingMachineProposalState.Finished,
              voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
            },
          },
        ),
        {chainId: 137},
      ),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
      ethRpcUrls: 'https://l1.example.com',
    };
    const results = await runVotingScan(ctx);
    expect(results[0]?.kind).toBe('closeAndSendVote');
    expect(results[0]?.txHash).toBe(TX);
    expect(spy.calls[0]?.functionName).toBe('closeAndSendVote');
  });

  test('createVote branch: recheck-fail records error', async () => {
    // After scan picks createVote, flip state so the recheck fails.
    let stateReads = 0;
    const spy = makeWalletSpy(TX);
    const mocks = buildMocks(
      [[20n], []],
      {
        '20': {
          state: VotingMachineProposalState.NotCreated,
          voteConfig: {votingDuration: 1, l1ProposalBlockHash: BLOCK_HASH},
        },
      },
      {'20': {hasRoots: true, govRoot: ('0x' + 'cd'.repeat(32)) as Hex}},
    );
    // Override getProposalState to flip on the recheck.
    mocks[`${VM}.getProposalState`] = () => {
      stateReads += 1;
      return stateReads <= 1
        ? VotingMachineProposalState.NotCreated
        : VotingMachineProposalState.Active;
    };
    const ctx = {
      chainId: 137,
      logger: silentLogger,
      publicClient: makeMockClient(mocks, {chainId: 137}),
      walletClient: makeMockWalletClient(spy, {chainId: 137, account: ACCOUNT}),
      account: ACCOUNT,
      ethRpcUrls: 'https://l1.example.com',
    };
    const results = await runVotingScan(ctx);
    expect(results[0]?.txHash).toBeUndefined();
    expect(results[0]?.error).toBeDefined();
    expect(spy.calls.length).toBe(0);
  });
});
