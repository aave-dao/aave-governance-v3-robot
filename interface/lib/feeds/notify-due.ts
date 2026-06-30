// Staleness alerting for Chainlink leaves. After a refresh (cron or manual), collect every
// feed flagged "due" (overdue past its heartbeat) across the scanned chains and, if any,
// fan out one notification to the configured channels via notifyHealth.

import { explorerBaseUrl } from '@robot/core/explorers';
import type { Logger } from '@robot/core/logger';
import { notifyHealth } from '@robot/core/notify';
import { fmtDuration } from './format';
import type { ChainFeedGraph } from './types';

export type DueFeed = {
  chainId: number;
  chainName: string;
  name: string;
  address: string;
  ageSec?: number;
  heartbeatSec?: number;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const overdueRatio = (d: DueFeed): number =>
  d.heartbeatSec && d.ageSec ? d.ageSec / d.heartbeatSec : 0;

/** Pull every due ChainlinkFeed node out of the scanned graphs, most-overdue first. */
export function collectDueFeeds(graphs: ChainFeedGraph[]): DueFeed[] {
  const out: DueFeed[] = [];
  for (const g of graphs) {
    for (const n of g.nodes) {
      if (!n.chainlink?.due) continue;
      out.push({
        chainId: g.chainId,
        chainName: g.name,
        name: n.chainlink.name ?? n.short,
        address: n.address,
        ageSec: n.chainlink.ageSec,
        heartbeatSec: n.chainlink.heartbeatSec,
      });
    }
  }
  return out.sort((a, b) => overdueRatio(b) - overdueRatio(a));
}

const MAX_LINES = 20;

/**
 * Notify if any feed is due. Returns the due count (0 = nothing sent). Best-effort: notifyHealth
 * is a no-op when no channels are configured and never throws.
 */
export async function notifyDueFeeds(
  graphs: ChainFeedGraph[],
  logger?: Logger,
): Promise<{ dueCount: number; due: DueFeed[] }> {
  const due = collectDueFeeds(graphs);
  if (due.length === 0) return { dueCount: 0, due };

  const shown = due.slice(0, MAX_LINES);
  const moreLine = due.length > shown.length ? `\n…and ${due.length - shown.length} more` : '';
  const age = (d: DueFeed) => (d.ageSec !== undefined ? fmtDuration(d.ageSec) : '?');
  const hb = (d: DueFeed) => (d.heartbeatSec !== undefined ? fmtDuration(d.heartbeatSec) : '?');
  const link = (d: DueFeed) => {
    const base = explorerBaseUrl(d.chainId);
    return base ? `${base}/address/${d.address}` : undefined;
  };

  const slack =
    `:hourglass_flowing_sand: *${due.length} Chainlink feed(s) overdue for update*\n` +
    shown
      .map((d) => {
        const url = link(d);
        const label = url ? `<${url}|${d.name}>` : `${d.name} (${d.address})`;
        return `• \`${d.chainName}\` ${label} — *${age(d)}* old (heartbeat ${hb(d)})`;
      })
      .join('\n') +
    moreLine;

  const tg =
    `⏳ <b>${due.length} Chainlink feed(s) overdue for update</b>\n` +
    shown
      .map((d) => {
        const url = link(d);
        const label = url ? `<a href="${url}">${escapeHtml(d.name)}</a>` : escapeHtml(d.name);
        return `• <code>${escapeHtml(d.chainName)}</code> ${label} — <b>${age(d)}</b> old (heartbeat ${hb(d)})`;
      })
      .join('\n') +
    moreLine;

  const plain =
    `⏳ ${due.length} Chainlink feed(s) overdue for update\n` +
    shown
      .map((d) => `• ${d.chainName} ${d.name} (${d.address}) — ${age(d)} old (heartbeat ${hb(d)})`)
      .join('\n') +
    moreLine;

  await notifyHealth({ slack, tg, plain, logger });
  return { dueCount: due.length, due };
}
