import {GovernanceV3Ethereum} from '@aave-dao/aave-address-book';
import type {Address, Hex} from 'viem';
import {governanceAbi} from '../core/abis';
import {GOVERNANCE_CHAIN_ID, EXECUTION_CHAINS} from '../core/chains';
import {getPublicClient} from '../core/clients';
import {fetchProposalMetadata, ipfsHashToCidV0, type ProposalMetadata} from '../core/ipfs';
import {proposalStateName} from '../core/state';
import {c} from './colors';

export type DecodeResult = {
  proposalId: bigint;
  state: string;
  ipfsHash: Hex;
  cid: string;
  metadata?: ProposalMetadata;
  metadataError?: string;
  payloads: Array<{
    chainId: number;
    chainName: string;
    payloadId: number;
    payloadsController: Address;
    accessLevel: number;
  }>;
};

export const decodeProposal = async (
  proposalId: bigint,
  opts: {fetchMetadata?: boolean} = {},
): Promise<DecodeResult> => {
  const client = getPublicClient(GOVERNANCE_CHAIN_ID);
  const proposal = await client.readContract({
    address: GovernanceV3Ethereum.GOVERNANCE as Address,
    abi: governanceAbi,
    functionName: 'getProposal',
    args: [proposalId],
  });

  let metadata: ProposalMetadata | undefined;
  let metadataError: string | undefined;
  if (opts.fetchMetadata !== false) {
    try {
      metadata = await fetchProposalMetadata(proposal.ipfsHash as Hex);
    } catch (err) {
      metadataError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    proposalId,
    state: proposalStateName(proposal.state),
    ipfsHash: proposal.ipfsHash as Hex,
    cid: ipfsHashToCidV0(proposal.ipfsHash as Hex),
    metadata,
    metadataError,
    payloads: proposal.payloads.map((p) => ({
      chainId: Number(p.chain),
      chainName: EXECUTION_CHAINS[Number(p.chain)]?.name ?? `chain-${p.chain}`,
      payloadId: Number(p.payloadId),
      payloadsController: p.payloadsController as Address,
      accessLevel: p.accessLevel,
    })),
  };
};

export const formatDecodeResult = (r: DecodeResult, opts: {full?: boolean} = {}): string => {
  const lines: string[] = [];
  lines.push(c.bold(`Proposal #${r.proposalId}`) + ' ' + c.dim(`(${r.state})`));

  if (r.metadata?.title) {
    lines.push('');
    lines.push(`  ${c.dim('title:    ')} ${c.bold(r.metadata.title)}`);
    if (r.metadata.author) lines.push(`  ${c.dim('author:   ')} ${c.italic(r.metadata.author)}`);
    if (r.metadata.discussions) {
      lines.push(`  ${c.dim('discuss:  ')} ${c.underline(c.cyan(r.metadata.discussions))}`);
    }
  } else if (r.metadataError) {
    lines.push('');
    lines.push(`  ${c.gray(`<metadata unavailable: ${r.metadataError}>`)}`);
  }

  lines.push('');
  lines.push(`  ${c.dim('ipfsHash: ')} ${c.gray(r.ipfsHash)}`);
  lines.push(`  ${c.dim('cid:      ')} ${c.gray(r.cid)}`);
  lines.push(`  ${c.dim('gateway:  ')} ${c.cyan(`https://ipfs.io/ipfs/${r.cid}`)}`);

  if (r.payloads.length > 0) {
    lines.push('');
    lines.push(`  ${c.bold('payloads:')}`);
    for (const p of r.payloads) {
      lines.push(
        `    ${c.cyan(`[${p.chainName}]`)} payload ${c.bold(`#${p.payloadId}`)} ` +
          c.gray(`accessLevel=${p.accessLevel} controller=${p.payloadsController}`),
      );
    }
  }

  if (opts.full && r.metadata?.body) {
    lines.push('');
    lines.push(c.dim('────── full body ──────'));
    lines.push(r.metadata.body.trim());
  } else if (r.metadata?.shortDescription) {
    lines.push('');
    lines.push(`  ${c.dim('summary:')}`);
    for (const para of splitParagraphs(r.metadata.shortDescription, 80)) {
      lines.push(`    ${para}`);
    }
  } else if (r.metadata && !opts.full) {
    lines.push('');
    lines.push(c.gray(`  (use --full to print the proposal body)`));
  }

  return lines.join('\n');
};

const splitParagraphs = (text: string, width: number): string[] => {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) out.push(line);
  return out;
};
