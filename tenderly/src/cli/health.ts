import {formatUnits, type Address} from 'viem';
import * as viemChains from 'viem/chains';
import type {Chain} from 'viem';
import {
  EXECUTION_CHAINS,
  GOVERNANCE_CHAIN_ID,
  VOTING_CHAINS,
  type VotingChainId,
} from '../core/chains';
import {accountFromPrivateKey, getPublicClient} from '../core/clients';
import type {Logger} from '../core/logger';
import {c, glyph} from './colors';
import {requirePrivateKey, type Env} from './env';

/**
 * Gas-unit estimates per action. These are conservative empirical averages — the actual
 * cost varies with payload size, cross-chain message bridging, etc. Refine them by
 * watching your own txs and updating these numbers.
 */
const GOV_ACTIONS = [
  {name: 'activateVoting', gasUnits: 300_000n},
  {name: 'executeProposal', gasUnits: 500_000n}, // cross-chain message cost
  {name: 'cancelProposal', gasUnits: 200_000n},
] as const;

const VOTING_ACTIONS = [
  {name: 'submitStorageRoots', gasUnits: 3_000_000n}, // 5 calls in Multicall3 + proofs
  {name: 'createVote', gasUnits: 200_000n},
  {name: 'closeAndSendVote', gasUnits: 400_000n}, // cross-chain message cost
] as const;

const EXEC_ACTIONS = [
  {name: 'executePayload', gasUnits: 2_500_000n}, // highly variable; conservative average
] as const;

type ActionCost = {name: string; gasUnits: bigint; costWei: bigint};

export type ChainHealth = {
  chainId: number;
  name: string;
  account: Address;
  nativeSymbol: string;
  balanceWei: bigint;
  gasPriceWei: bigint;
  actions: ActionCost[];
  roundCostWei: bigint;
  rounds: number; // floor(balance / roundCost). Infinity if roundCost == 0.
  status: 'ok' | 'warn' | 'critical' | 'error';
  error?: string;
};

const viemChainByChainId = (chainId: number): Chain | undefined => {
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === 'object' && 'id' in (v as object) && (v as Chain).id === chainId) {
      return v as Chain;
    }
  }
  return undefined;
};

const nativeSymbol = (chainId: number): string => viemChainByChainId(chainId)?.nativeCurrency.symbol ?? 'ETH';

const actionsForChain = (chainId: number): readonly {name: string; gasUnits: bigint}[] => {
  const isGov = chainId === GOVERNANCE_CHAIN_ID;
  const isVoting = chainId in VOTING_CHAINS;
  const isExec = chainId in EXECUTION_CHAINS;
  return [
    ...(isGov ? GOV_ACTIONS : []),
    ...(isVoting ? VOTING_ACTIONS : []),
    ...(isExec ? EXEC_ACTIONS : []),
  ];
};

const classifyStatus = (rounds: number, minRounds: number): ChainHealth['status'] => {
  if (rounds < Math.max(1, Math.floor(minRounds / 4))) return 'critical';
  if (rounds < minRounds) return 'warn';
  return 'ok';
};

/**
 * Collect per-chain health for every chain the robot signs txs on. Runs all RPC calls in
 * parallel — slow chains don't block fast ones.
 */
export const collectHealth = async (
  env: Env,
  logger: Logger,
  opts: {minRounds: number},
): Promise<ChainHealth[]> => {
  const account = accountFromPrivateKey(requirePrivateKey(env));
  const seen = new Set<number>();
  const chainIds: number[] = [];
  const push = (id: number) => {
    if (!seen.has(id)) {
      seen.add(id);
      chainIds.push(id);
    }
  };
  push(GOVERNANCE_CHAIN_ID);
  for (const id of Object.keys(VOTING_CHAINS).map(Number) as VotingChainId[]) push(id);
  for (const id of Object.keys(EXECUTION_CHAINS).map(Number)) push(id);

  return Promise.all(
    chainIds.map(async (chainId): Promise<ChainHealth> => {
      const name =
        VOTING_CHAINS[chainId as VotingChainId]?.name ??
        EXECUTION_CHAINS[chainId]?.name ??
        `chain-${chainId}`;
      try {
        const client = getPublicClient(chainId);
        const [balance, gasPriceWei] = await Promise.all([
          client.getBalance({address: account}),
          client.getGasPrice(),
        ]);
        logger.trace('health: chain probed', {
          chainId,
          chain: name,
          balance: balance.toString(),
          gasPrice: gasPriceWei.toString(),
        });

        const actions: ActionCost[] = actionsForChain(chainId).map((a) => ({
          name: a.name,
          gasUnits: a.gasUnits,
          costWei: a.gasUnits * gasPriceWei,
        }));
        const roundCostWei = actions.reduce((acc, a) => acc + a.costWei, 0n);
        const rounds = roundCostWei === 0n ? Infinity : Number(balance / roundCostWei);

        return {
          chainId,
          name,
          account,
          nativeSymbol: nativeSymbol(chainId),
          balanceWei: balance,
          gasPriceWei,
          actions,
          roundCostWei,
          rounds,
          status: classifyStatus(rounds, opts.minRounds),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('health: chain probe failed', {chainId, chain: name, error: msg});
        return {
          chainId,
          name,
          account,
          nativeSymbol: nativeSymbol(chainId),
          balanceWei: 0n,
          gasPriceWei: 0n,
          actions: [],
          roundCostWei: 0n,
          rounds: 0,
          status: 'error',
          error: msg,
        };
      }
    }),
  );
};

// ---------- formatting --------------------------------------------------------------

const fmtNative = (wei: bigint, symbol: string, dp = 4): string => {
  const s = formatUnits(wei, 18);
  const [whole, decimals = ''] = s.split('.');
  const truncated = decimals.slice(0, dp).padEnd(dp, '0');
  return `${Number(whole).toLocaleString('en-US')}.${truncated} ${symbol}`;
};

const fmtGwei = (wei: bigint): string => {
  const s = formatUnits(wei, 9);
  const num = Number(s);
  return `${num.toLocaleString('en-US', {maximumFractionDigits: 2})} gwei`;
};

const fmtGasUnits = (n: bigint): string => Number(n).toLocaleString('en-US');

const colorStatus = (status: ChainHealth['status']): string => {
  switch (status) {
    case 'ok':
      return c.green('OK');
    case 'warn':
      return c.yellow('WARN');
    case 'critical':
      return c.red('CRITICAL');
    case 'error':
      return c.red('ERROR');
  }
};

const padRight = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const padLeft = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

export const formatHealthReport = (
  rows: ChainHealth[],
  opts: {minRounds: number},
): string => {
  const lines: string[] = [];
  const account = rows[0]?.account ?? '0x';
  lines.push(c.bold(`Health check for ${account}`));
  lines.push(c.gray(`(threshold: warn below ${opts.minRounds} rounds)`));
  lines.push('');

  for (const row of rows) {
    const header = `${c.cyan(`[${row.name}]`)} ${c.gray(`chainId ${row.chainId}`)}`;
    lines.push(header);

    if (row.status === 'error') {
      lines.push(`  ${glyph.warn} ${c.red('failed to probe:')} ${c.dim(row.error ?? 'unknown')}`);
      lines.push('');
      continue;
    }

    lines.push(
      `  ${c.dim('balance:')} ${c.bold(fmtNative(row.balanceWei, row.nativeSymbol))}` +
        `   ${c.dim('gas:')} ${fmtGwei(row.gasPriceWei)}`,
    );

    if (row.actions.length === 0) {
      lines.push(`  ${c.gray('(no actions defined for this chain role)')}`);
      lines.push('');
      continue;
    }

    // Table of action costs.
    const nameW = Math.max(...row.actions.map((a) => a.name.length), 'TOTAL per round'.length);
    const gasW = Math.max(...row.actions.map((a) => fmtGasUnits(a.gasUnits).length), 9);
    const costStrings = row.actions.map((a) => fmtNative(a.costWei, row.nativeSymbol));
    const costW = Math.max(...costStrings.map((s) => s.length), fmtNative(row.roundCostWei, row.nativeSymbol).length);

    lines.push('');
    lines.push(
      '  ' +
        c.gray(padRight('action', nameW)) +
        '  ' +
        c.gray(padLeft('gas units', gasW)) +
        '  ' +
        c.gray(padLeft('cost', costW)),
    );
    lines.push('  ' + c.dim('─'.repeat(nameW + 2 + gasW + 2 + costW)));

    for (const [i, a] of row.actions.entries()) {
      lines.push(
        '  ' +
          padRight(a.name, nameW) +
          '  ' +
          padLeft(fmtGasUnits(a.gasUnits), gasW) +
          '  ' +
          padLeft(costStrings[i]!, costW),
      );
    }

    lines.push('  ' + c.dim('─'.repeat(nameW + 2 + gasW + 2 + costW)));
    const totalGas = row.actions.reduce((acc, a) => acc + a.gasUnits, 0n);
    lines.push(
      '  ' +
        c.bold(padRight('TOTAL per round', nameW)) +
        '  ' +
        c.bold(padLeft(fmtGasUnits(totalGas), gasW)) +
        '  ' +
        c.bold(padLeft(fmtNative(row.roundCostWei, row.nativeSymbol), costW)),
    );

    lines.push('');
    const roundsLabel =
      row.rounds === Infinity
        ? 'unlimited'
        : `~${row.rounds.toLocaleString('en-US')} round${row.rounds === 1 ? '' : 's'} remaining`;
    lines.push(`  → ${c.bold(roundsLabel)}   ${colorStatus(row.status)}`);
    lines.push('');
  }

  // Summary footer.
  const warns = rows.filter((r) => r.status === 'warn' || r.status === 'critical');
  const errors = rows.filter((r) => r.status === 'error');
  if (warns.length === 0 && errors.length === 0) {
    lines.push(`${glyph.done} ${c.green('all chains healthy')}`);
  } else {
    if (warns.length > 0) {
      lines.push(
        `${glyph.warn} ${c.yellow(`${warns.length} chain${warns.length === 1 ? '' : 's'} below threshold:`)} ${warns
          .map((r) => r.name)
          .join(', ')}`,
      );
    }
    if (errors.length > 0) {
      lines.push(
        `${glyph.warn} ${c.red(`${errors.length} chain${errors.length === 1 ? '' : 's'} could not be probed:`)} ${errors
          .map((r) => r.name)
          .join(', ')}`,
      );
    }
  }

  return lines.join('\n');
};
