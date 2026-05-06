// Find Aave Governance V3 cancellation-fee redemptions whose ETH would land on a given
// author address.
//
// Mechanics (from GovernanceCore.sol::redeemCancellationFee):
//   • state == Cancelled       → fee goes to CANCELLATION_FEE_COLLECTOR (treasury)
//   • state in {Executed, Failed, Expired} → fee goes to proposal.creator
//   • else                      → reverts (still locked)
// Anyone can call `redeemCancellationFee(uint256[])`; only the destination is fixed by
// the contract. So this command finds proposals whose redemption would credit the author
// and prints the call data ready to broadcast (no RPC writes here).

import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import {
  encodeFunctionData,
  formatEther,
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {governanceAbi} from '../core/abis';
import {GOVERNANCE_CHAIN_ID} from '../core/chains';
import {getPublicClient} from '../core/clients';
import {ProposalState, proposalStateName} from '../core/state';
import {c} from './colors';

/** Final states whose redemption pays the proposal creator. */
const REDEEMABLE_STATES: ReadonlySet<number> = new Set([
  ProposalState.Executed,
  ProposalState.Failed,
  ProposalState.Expired,
]);

export type RedeemableEntry = {
  proposalId: bigint;
  state: number;
  cancellationFee: bigint;
  creator: Address;
};

export type RedeemableReport = {
  author: string;
  resolvedAuthor: Address;
  scannedFrom: bigint;
  scannedTo: bigint;
  totalProposals: bigint;
  entries: RedeemableEntry[];
  totalFee: bigint;
  /** Encoded `redeemCancellationFee(uint256[])` call data, undefined when entries is empty. */
  calldata: Hex | undefined;
};

const ZERO = '0x0000000000000000000000000000000000000000' as const;

const resolveAuthor = async (
  client: PublicClient,
  author: string,
): Promise<Address> => {
  const trimmed = author.trim();
  if (isAddress(trimmed)) return getAddress(trimmed);
  // viem's getEnsAddress does both forward + reverse — we only need forward here.
  const resolved = await client.getEnsAddress({name: trimmed.toLowerCase()});
  if (!resolved || resolved === ZERO) {
    throw new Error(`could not resolve author "${author}" via ENS or as a 0x-address`);
  }
  return getAddress(resolved);
};

export const findRedeemable = async (opts: {
  author: string;
  count: number;
  client?: PublicClient;
}): Promise<RedeemableReport> => {
  const client = (opts.client ?? getPublicClient(GOVERNANCE_CHAIN_ID)) as PublicClient;
  const resolvedAuthor = await resolveAuthor(client, opts.author);
  const lowerAuthor = resolvedAuthor.toLowerCase();
  const govAddr = GovernanceV3Ethereum.GOVERNANCE as Address;

  const total = (await client.readContract({
    address: govAddr,
    abi: governanceAbi,
    functionName: 'getProposalsCount',
  })) as bigint;

  if (total === 0n) {
    return {
      author: opts.author,
      resolvedAuthor,
      scannedFrom: 0n,
      scannedTo: 0n,
      totalProposals: 0n,
      entries: [],
      totalFee: 0n,
      calldata: undefined,
    };
  }

  // Last N proposals: ids [scannedFrom .. scannedTo] inclusive, descending.
  const N = BigInt(Math.max(1, opts.count));
  const scannedTo = total - 1n;
  const scannedFrom = N >= total ? 0n : total - N;

  const ids: bigint[] = [];
  for (let id = scannedTo; ; id--) {
    ids.push(id);
    if (id === scannedFrom) break;
  }

  // Fetch the stored struct + the live state in parallel for each id. The struct gives
  // creator + cancellationFee; live state catches Failed/Expired which aren't persisted.
  const proposals = await Promise.all(
    ids.map((id) =>
      client.readContract({
        address: govAddr,
        abi: governanceAbi,
        functionName: 'getProposal',
        args: [id],
      }),
    ),
  );
  const liveStates = await Promise.all(
    ids.map((id) =>
      client.readContract({
        address: govAddr,
        abi: governanceAbi,
        functionName: 'getProposalState',
        args: [id],
      }),
    ),
  );

  const entries: RedeemableEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const p = proposals[i]!;
    const state = Number(liveStates[i]);
    if (!REDEEMABLE_STATES.has(state)) continue;
    if (p.cancellationFee === 0n) continue;
    if (String(p.creator).toLowerCase() !== lowerAuthor) continue;
    entries.push({
      proposalId: id,
      state,
      cancellationFee: p.cancellationFee,
      creator: getAddress(p.creator as Address),
    });
  }

  const totalFee = entries.reduce((acc, e) => acc + e.cancellationFee, 0n);

  const calldata =
    entries.length > 0
      ? (encodeFunctionData({
          abi: governanceAbi,
          functionName: 'redeemCancellationFee',
          args: [entries.map((e) => e.proposalId)],
        }) as Hex)
      : undefined;

  return {
    author: opts.author,
    resolvedAuthor,
    scannedFrom,
    scannedTo,
    totalProposals: total,
    entries,
    totalFee,
    calldata,
  };
};

const fmtEth = (wei: bigint): string => `${formatEther(wei)} ETH`;

export const formatRedeemableReport = (r: RedeemableReport): string => {
  const lines: string[] = [];
  const authorLabel =
    r.author.toLowerCase() === r.resolvedAuthor.toLowerCase()
      ? r.resolvedAuthor
      : `${r.author} ${c.dim('→')} ${r.resolvedAuthor}`;
  lines.push(`${c.bold('Author:')} ${authorLabel}`);

  if (r.totalProposals === 0n) {
    lines.push(c.dim('No proposals exist on the governance contract yet.'));
    return lines.join('\n');
  }

  const window = `#${r.scannedFrom.toString()}..#${r.scannedTo.toString()}`;
  const span = r.scannedTo - r.scannedFrom + 1n;
  lines.push(
    `${c.bold('Scanned:')} ${span.toString()} proposals ${c.dim(window)} ` +
      `${c.dim(`(of ${r.totalProposals.toString()} total)`)}`,
  );
  lines.push('');

  if (r.entries.length === 0) {
    lines.push(c.dim('No redeemable proposals found in this window for this author.'));
    return lines.join('\n');
  }

  lines.push(c.bold('Redeemable proposals:'));
  for (const e of r.entries) {
    const stateName = proposalStateName(e.state);
    const stateColored =
      e.state === ProposalState.Executed
        ? c.green(stateName)
        : e.state === ProposalState.Failed
          ? c.red(stateName)
          : c.yellow(stateName);
    lines.push(
      `  ${c.bold(`#${e.proposalId.toString().padStart(4, ' ')}`)}  ` +
        `${stateColored.padEnd(20, ' ')}  ` +
        `${fmtEth(e.cancellationFee).padStart(20, ' ')}`,
    );
  }
  lines.push('');
  lines.push(
    `${c.bold('Total:')} ${r.entries.length} proposal${r.entries.length === 1 ? '' : 's'} ` +
      `${c.dim('·')} ${c.green(fmtEth(r.totalFee))}`,
  );

  if (r.calldata) {
    lines.push('');
    lines.push(c.bold('Calldata for redeemCancellationFee:'));
    lines.push(`  ${r.calldata}`);
    lines.push('');
    lines.push(c.dim('Send with:'));
    lines.push(
      c.dim(
        `  cast send ${GovernanceV3Ethereum.GOVERNANCE} ${r.calldata} --rpc-url <l1-rpc> --private-key <key>`,
      ),
    );
  }

  return lines.join('\n');
};
