import type { ActionStatus, InspectorReport } from '../orchestration/proposalInspector';
import { ProposalState, VotingMachineProposalState, PayloadState } from '../core/state';
import { c, glyph } from './colors';

const fmtTimestamp = (sec: number): string => {
  if (!sec) return c.gray('not yet');
  const date = new Date(sec * 1000);
  const ago = Math.floor((Date.now() - date.getTime()) / 1000);
  const rel = ago < 0 ? `in ${humanDuration(-ago)}` : `${humanDuration(ago)} ago`;
  return `${date.toISOString().replace('T', ' ').slice(0, 19)}Z ${c.gray(`(${rel})`)}`;
};

const humanDuration = (sec: number): string => {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d${Math.floor((sec % 86400) / 3600)}h`;
};

const colorProposalState = (n: number, name: string): string => {
  switch (n) {
    case ProposalState.Created: return c.cyan(name);
    case ProposalState.Active: return c.bold(c.cyan(name));
    case ProposalState.Queued: return c.yellow(name);
    case ProposalState.Executed: return c.green(name);
    case ProposalState.Failed: return c.red(name);
    case ProposalState.Cancelled: return c.gray(name);
    case ProposalState.Expired: return c.gray(name);
    default: return name;
  }
};

const colorVmState = (n: number, name: string): string => {
  switch (n) {
    case VotingMachineProposalState.NotCreated: return c.gray(name);
    case VotingMachineProposalState.Active: return c.bold(c.cyan(name));
    case VotingMachineProposalState.Finished: return c.yellow(name);
    case VotingMachineProposalState.SentToGovernance: return c.green(name);
    default: return name;
  }
};

const colorPayloadState = (n: number, name: string): string => {
  switch (n) {
    case PayloadState.Created: return c.cyan(name);
    case PayloadState.Queued: return c.yellow(name);
    case PayloadState.Executed: return c.green(name);
    case PayloadState.Cancelled: return c.gray(name);
    case PayloadState.Expired: return c.gray(name);
    default: return name;
  }
};

const fmtAction = (a: ActionStatus): string => {
  if (a.status === 'ready') return `${glyph.ready} ${c.bold(c.yellow(a.name))} ${c.gray('— ready')}`;
  if (a.status === 'done') return `${glyph.done} ${c.green(a.name)} ${c.gray(`— ${a.reason}`)}`;
  return `${glyph.blocked} ${c.gray(a.name)}: ${c.dim(a.reason)}`;
};

const truncate = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1) + '…');

/** Maps internal action module names to the user-facing CLI command names. */
const ACTION_TO_COMMAND: Record<string, string> = {
  activateVoting: 'activate',
  executeProposal: 'execute',
  cancelProposal: 'cancel',
  submitStorageRoots: 'submit-roots',
  createVote: 'create-vote',
  closeAndSendVote: 'close-vote',
  executePayload: 'execute-payload',
};

export const formatInspectorReport = (report: InspectorReport): string => {
  const lines: string[] = [];
  const gov = report.governance;

  lines.push(c.bold(`Proposal #${report.proposalId} ${c.dim('on')} ${c.cyan('ethereum')}`));
  lines.push('');

  // Metadata header (title + author + discussions).
  if (report.metadata?.title) {
    lines.push(`  ${c.bold(report.metadata.title)}`);
    if (report.metadata.author) lines.push(`  ${c.gray('by')} ${c.italic(report.metadata.author)}`);
    if (report.metadata.discussions) {
      lines.push(`  ${c.gray('discuss:')} ${c.underline(c.cyan(report.metadata.discussions))}`);
    }
  } else if (report.metadataError) {
    lines.push(`  ${c.gray(`<metadata unavailable: ${report.metadataError}>`)}`);
  }
  lines.push('');

  // Governance section.
  lines.push(`  ${c.dim('state:        ')} ${colorProposalState(gov.stateNumber, gov.state)}`);
  lines.push(`  ${c.dim('creator:      ')} ${gov.creator}`);
  lines.push(`  ${c.dim('createdAt:    ')} ${fmtTimestamp(gov.creationTime)}`);
  if (gov.queuingTime) lines.push(`  ${c.dim('queuedAt:     ')} ${fmtTimestamp(gov.queuingTime)}`);
  lines.push(`  ${c.dim('votingPortal: ')} ${gov.votingPortal}`);
  lines.push(`  ${c.dim('snapshot:     ')} ${c.gray(gov.snapshotBlockHash)}`);
  lines.push(`  ${c.dim('ipfsHash:     ')} ${c.gray(gov.ipfsHash)}`);
  lines.push('');
  lines.push(`  ${c.bold('governance actions:')}`);
  for (const a of gov.actions) lines.push(`    ${fmtAction(a)}`);

  if (report.voting) {
    lines.push('');
    lines.push(
      `  ${c.bold('voting')} ${c.dim(`(${report.voting.chain}, chainId ${report.voting.chainId})`)}:`,
    );
    lines.push(`    ${c.dim('state:        ')} ${colorVmState(report.voting.stateNumber, report.voting.state)}`);
    lines.push(`    ${c.dim('l1BlockHash:  ')} ${c.gray(report.voting.l1ProposalBlockHash)}`);
    for (const a of report.voting.actions) lines.push(`    ${fmtAction(a)}`);
  }

  if (report.payloads.length > 0) {
    lines.push('');
    lines.push(`  ${c.bold('payloads:')}`);
    for (const p of report.payloads) {
      const stateColored = p.stateNumber >= 0 ? colorPayloadState(p.stateNumber, p.state) : c.gray(p.state);
      const meta = p.actionCount > 0 ? c.gray(`(${p.actionCount} action${p.actionCount === 1 ? '' : 's'})`) : '';
      lines.push(`    ${c.cyan(`[${p.chainName}]`)} payload ${c.bold(`#${p.payloadId}`)} ${c.dim('state=')}${stateColored} ${meta}`);
      for (const a of p.actions) lines.push(`      ${fmtAction(a)}`);
    }
  }

  lines.push('');
  if (report.nextRecommended) {
    const n = report.nextRecommended;
    const cmdName = ACTION_TO_COMMAND[n.action] ?? n.action;
    let cmd: string;
    if (n.stage === 'governance') cmd = `${cmdName} ${report.proposalId}`;
    else if (n.stage === 'voting') cmd = `${cmdName} ${report.proposalId} --chain ${report.voting?.chain}`;
    else {
      const p = report.payloads.find((pp) => pp.chainId === n.chainId && BigInt(pp.payloadId) === n.id);
      cmd = `execute-payload ${n.id} --chain ${p?.chainName}`;
    }
    lines.push(`${glyph.ready} ${c.yellow('next:')} ${c.bold(`bun run robot ${cmd}`)}`);
  } else {
    lines.push(`${glyph.done} ${c.green('nothing actionable right now')}`);
  }

  // Optional summary preview from IPFS.
  if (report.metadata?.shortDescription) {
    lines.push('');
    lines.push(`  ${c.dim('summary:')} ${truncate(report.metadata.shortDescription, 240)}`);
  }

  return lines.join('\n');
};
