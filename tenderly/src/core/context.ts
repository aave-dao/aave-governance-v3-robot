import type { Address, Hex, PublicClient, WalletClient } from 'viem';
import type { Logger } from './logger';

/** Read-only execution context — used by `check()` predicates and inspector. */
export type ReadContext = {
  chainId: number;
  publicClient: PublicClient;
  logger: Logger;
};

/** Read+write context — used by `execute()` and CLI write commands. */
export type WriteContext = ReadContext & {
  walletClient: WalletClient;
  account: Address;
};

export type CheckOk = { ok: true };
export type CheckSkip = { ok: false; reason: string };
export type CheckResult = CheckOk | CheckSkip;

export type ExecuteResult = { txHash: Hex };

/** Common shape implemented by every action module. */
export interface ActionModule<Id = bigint> {
  readonly name: string;
  check(ctx: ReadContext, id: Id): Promise<CheckResult>;
  execute(ctx: WriteContext, id: Id): Promise<ExecuteResult>;
}

/** Shared L1 read context for actions that need to consult the governance chain. */
export type L1ReadContext = {
  l1Public: PublicClient;
  governance: Address;
};
