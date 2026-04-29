import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type EligibilityCheck = {
  eligible: boolean;
  reason?: string;
  etaAt?: number;
};

export type EligibilityBlob = {
  activate: EligibilityCheck;
  execute: EligibilityCheck;
  cancel: EligibilityCheck;
  voting?: {
    chainId: number;
    chainName: string;
    state: string;
    stateNumber: number;
    submitStorageRoots: EligibilityCheck;
    createVote: EligibilityCheck;
    closeAndSendVote: EligibilityCheck;
  };
  payloads: Array<{
    chainId: number;
    chainName: string;
    payloadId: number;
    state: string;
    stateNumber: number;
    executable: EligibilityCheck;
  }>;
};

export type ProposalMetadataBlob = {
  title?: string;
  author?: string;
  discussions?: string;
  shortDescription?: string;
  body: string;
  raw: string;
};

export type NextRecommendedBlob = {
  stage: 'governance' | 'voting' | 'payload';
  action: string;
  chainId: number;
  id: string;
};

export const proposals = pgTable(
  'proposals',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    state: integer('state').notNull(),
    stateName: text('state_name').notNull(),
    creator: text('creator').notNull(),
    creationTime: integer('creation_time').notNull(),
    votingActivationTime: integer('voting_activation_time').notNull(),
    queuingTime: integer('queuing_time').notNull(),
    votingDuration: integer('voting_duration').notNull().default(0),
    cooldownPeriod: integer('cooldown_period').notNull().default(0),
    coolDownBeforeVotingStart: integer('cool_down_before_voting_start').notNull().default(0),
    accessLevel: integer('access_level').notNull(),
    snapshotBlockHash: text('snapshot_block_hash').notNull(),
    ipfsHash: text('ipfs_hash').notNull(),
    votingPortal: text('voting_portal').notNull(),
    metadata: jsonb('metadata').$type<ProposalMetadataBlob | null>(),
    metadataError: text('metadata_error'),
    eligibility: jsonb('eligibility').$type<EligibilityBlob>().notNull(),
    nextRecommended: jsonb('next_recommended').$type<NextRecommendedBlob | null>(),
    raw: jsonb('raw').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index('proposals_state_idx').on(t.state),
    refreshedAtIdx: index('proposals_refreshed_at_idx').on(t.refreshedAt),
  }),
);

export const payloads = pgTable(
  'payloads',
  {
    chainId: integer('chain_id').notNull(),
    payloadId: integer('payload_id').notNull(),
    proposalId: bigint('proposal_id', { mode: 'bigint' }).notNull(),
    chainName: text('chain_name').notNull(),
    payloadsController: text('payloads_controller').notNull(),
    state: integer('state').notNull(),
    stateName: text('state_name').notNull(),
    actionCount: integer('action_count').notNull(),
    queuedAt: integer('queued_at'),
    delay: integer('delay'),
    executable: jsonb('executable').$type<EligibilityCheck>().notNull(),
    raw: jsonb('raw'),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('payloads_pk').on(t.chainId, t.payloadId),
    proposalIdx: index('payloads_proposal_idx').on(t.proposalId),
    refreshedAtIdx: index('payloads_refreshed_at_idx').on(t.refreshedAt),
  }),
);

export const executions = pgTable(
  'executions',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    proposalId: bigint('proposal_id', { mode: 'bigint' }),
    chainId: integer('chain_id').notNull(),
    payloadId: integer('payload_id'),
    status: text('status').$type<'pending' | 'submitted' | 'confirmed' | 'failed'>().notNull(),
    txHash: text('tx_hash'),
    error: text('error'),
    requestedBy: text('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    proposalIdx: index('executions_proposal_idx').on(t.proposalId),
    statusIdx: index('executions_status_idx').on(t.status),
    createdAtIdx: index('executions_created_at_idx').on(t.createdAt),
  }),
);

export const cronRuns = pgTable(
  'cron_runs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ok: boolean('ok'),
    durationMs: integer('duration_ms'),
    summary: jsonb('summary'),
    error: text('error'),
  },
  (t) => ({
    nameStartedIdx: index('cron_runs_name_started_idx').on(t.name, t.startedAt),
  }),
);

export const cursors = pgTable('cursors', {
  name: text('name').primaryKey(),
  chainId: integer('chain_id').notNull(),
  lastBlock: bigint('last_block', { mode: 'bigint' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Proposal = typeof proposals.$inferSelect;
export type Payload = typeof payloads.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
export type Cursor = typeof cursors.$inferSelect;
