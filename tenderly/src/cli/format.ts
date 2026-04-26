import type {ActionStatus, InspectorReport} from '../orchestration/proposalInspector';
import {ProposalState, VotingMachineProposalState, PayloadState} from '../core/state';
import {c, glyph} from './colors';

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
    case ProposalState.Created:
      return c.cyan(name);
    case ProposalState.Active:
      return c.bold(c.cyan(name));
    case ProposalState.Queued:
      return c.yellow(name);
    case ProposalState.Executed:
      return c.green(name);
    case ProposalState.Failed:
      return c.red(name);
    case ProposalState.Cancelled:
      return c.gray(name);
    case ProposalState.Expired:
      return c.gray(name);
    default:
      return name;
  }
};

const colorVmState = (n: number, name: string): string => {
  switch (n) {
    case VotingMachineProposalState.NotCreated:
      return c.gray(name);
    case VotingMachineProposalState.Active:
      return c.bold(c.cyan(name));
    case VotingMachineProposalState.Finished:
      return c.yellow(name);
    case VotingMachineProposalState.SentToGovernance:
      return c.green(name);
    default:
      return name;
  }
};

const colorPayloadState = (n: number, name: string): string => {
  switch (n) {
    case PayloadState.Created:
      return c.cyan(name);
    case PayloadState.Queued:
      return c.yellow(name);
    case PayloadState.Executed:
      return c.green(name);
    case PayloadState.Cancelled:
      return c.gray(name);
    case PayloadState.Expired:
      return c.gray(name);
    default:
      return name;
  }
};

/**
 * IST = UTC + 5h30m. Used for the bracketed absolute timestamp on long ETAs.
 * Format: "Apr 27 22:00 IST".
 */
const fmtIST = (unixSec: number): string => {
  const d = new Date(unixSec * 1000);
  // Manually compute IST components to avoid depending on the runtime's locale tz.
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60_000);
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][ist.getUTCMonth()];
  const day = ist.getUTCDate();
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} ${hh}:${mm} IST`;
};

const fmtEta = (etaAt: number): string => {
  const remaining = etaAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return c.yellow('eta now');
  const dur = humanDuration(remaining);
  // For long ETAs, the absolute date is more useful than reading "3d4h12m".
  if (remaining > 6 * 3600) return `${c.yellow(`eta ${dur}`)} ${c.gray(`(${fmtIST(etaAt)})`)}`;
  return c.yellow(`eta ${dur}`);
};

const fmtAction = (a: ActionStatus): string => {
  if (a.status === 'ready')
    return `${glyph.ready} ${c.bold(c.yellow(a.name))} ${c.gray('— ready')}`;
  if (a.status === 'done') return `${glyph.done} ${c.green(a.name)} ${c.gray(`— ${a.reason}`)}`;
  const etaPart = a.etaAt ? ` ${fmtEta(a.etaAt)}` : '';
  return `${glyph.blocked} ${c.gray(a.name)}: ${c.dim(a.reason)}${etaPart}`;
};

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + '…';

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

  // Compact status header.
  lines.push(`  ${c.dim('gov state:    ')} ${colorProposalState(gov.stateNumber, gov.state)}`);
  if (report.voting) {
    lines.push(
      `  ${c.dim('voting state: ')} ${colorVmState(report.voting.stateNumber, report.voting.state)} ${c.gray(`(${report.voting.chain})`)}`,
    );
  }
  lines.push(`  ${c.dim('creator:      ')} ${gov.creator}`);
  lines.push(`  ${c.dim('createdAt:    ')} ${fmtTimestamp(gov.creationTime)}`);
  if (gov.queuingTime) lines.push(`  ${c.dim('queuedAt:     ')} ${fmtTimestamp(gov.queuingTime)}`);
  lines.push(`  ${c.dim('ipfsHash:     ')} ${c.gray(gov.ipfsHash)}`);

  // Lifecycle: a single ordered list following the actual proposal flow.
  // activateVoting → submitStorageRoots → createVote → closeAndSendVote → executeProposal → executePayload(s).
  const lifecycle: Array<{status: ActionStatus; scope?: string}> = [];

  const findGov = (name: string) => gov.actions.find((a) => a.name === name);
  const findVoting = (name: string) => report.voting?.actions.find((a) => a.name === name);

  const activate = findGov('activateVoting');
  if (activate) lifecycle.push({status: activate});

  const submit = findVoting('submitStorageRoots');
  if (submit) lifecycle.push({status: submit});
  const createVote = findVoting('createVote');
  if (createVote) lifecycle.push({status: createVote});
  const closeVote = findVoting('closeAndSendVote');
  if (closeVote) lifecycle.push({status: closeVote});

  const exec = findGov('executeProposal');
  if (exec) lifecycle.push({status: exec});

  for (const p of report.payloads) {
    // The action's reason already carries the state ("state=Created, want Queued"); no need
    // to repeat it in the per-payload prefix. For *done* payloads (where the action has no
    // reason mentioning state), append the colored state to the prefix so the user still sees it.
    const showStateInPrefix = p.actions.every((a) => a.status === 'done' || a.status === 'ready');
    const stateBadge =
      showStateInPrefix && p.stateNumber >= 0
        ? ` ${c.dim('state=')}${colorPayloadState(p.stateNumber, p.state)}`
        : '';
    for (const a of p.actions) {
      lifecycle.push({
        status: a,
        scope: `${c.cyan(`[${p.chainName}]`)} #${p.payloadId}${stateBadge}`,
      });
    }
  }

  lines.push('');
  lines.push(`  ${c.bold('lifecycle:')}`);
  for (const item of lifecycle) {
    const action = fmtAction(item.status);
    lines.push(`    ${item.scope ? `${item.scope} ` : ''}${action}`);
  }

  // Cancellation is a side path — render it separately so it doesn't muddy the timeline.
  const cancel = findGov('cancelProposal');
  if (cancel) {
    lines.push('');
    lines.push(`  ${c.dim('cancellation:')}`);
    lines.push(`    ${fmtAction(cancel)}`);
  }

  lines.push('');
  if (report.nextRecommended) {
    const n = report.nextRecommended;
    const cmdName = ACTION_TO_COMMAND[n.action] ?? n.action;
    let cmd: string;
    if (n.stage === 'governance') cmd = `${cmdName} ${report.proposalId}`;
    else if (n.stage === 'voting') cmd = `${cmdName} ${report.proposalId}`;
    else {
      const p = report.payloads.find(
        (pp) => pp.chainId === n.chainId && BigInt(pp.payloadId) === n.id,
      );
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
