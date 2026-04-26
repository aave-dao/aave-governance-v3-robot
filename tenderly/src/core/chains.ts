import {
  GovernanceV3Ethereum,
  GovernanceV3Polygon,
  GovernanceV3Avalanche,
  GovernanceV3Arbitrum,
  GovernanceV3Optimism,
  GovernanceV3Base,
  GovernanceV3BNB,
  GovernanceV3Gnosis,
  GovernanceV3Metis,
  GovernanceV3Scroll,
  GovernanceV3Celo,
  GovernanceV3Linea,
  GovernanceV3Mantle,
  GovernanceV3Ink,
  GovernanceV3Plasma,
  GovernanceV3MegaEth,
  GovernanceV3Soneium,
  GovernanceV3Sonic,
  GovernanceV3XLayer,
  GovernanceV3ZkSync,
} from '@aave-dao/aave-address-book';
import type { Address, Hex } from 'viem';

/** Identifier for the governance chain (only Ethereum mainnet today). */
export const GOVERNANCE_CHAIN_ID = GovernanceV3Ethereum.CHAIN_ID;

/**
 * Voting chains run a VotingMachine + DataWarehouse and receive storage roots from L1.
 * Currently active in production: Ethereum, Polygon, Avalanche.
 */
export type VotingChainId = 1 | 137 | 43114;

export type VotingChainConfig = {
  chainId: VotingChainId;
  name: string;
  governance: Address;          // L1 governance contract address (constant across voting chains)
  votingPortal: Address;        // Voting portal on L1 that routes to this voting machine
  votingMachine: Address;       // VotingMachineWithProofs on the voting chain
  dataWarehouse: Address;       // DataWarehouse on the voting chain
  votingStrategy: Address;      // VotingStrategy on the voting chain
};

export const VOTING_CHAINS: Record<VotingChainId, VotingChainConfig> = {
  1: {
    chainId: 1,
    name: 'ethereum',
    governance: GovernanceV3Ethereum.GOVERNANCE as Address,
    votingPortal: GovernanceV3Ethereum.VOTING_PORTAL_ETH_ETH as Address,
    votingMachine: GovernanceV3Ethereum.VOTING_MACHINE as Address,
    dataWarehouse: GovernanceV3Ethereum.DATA_WAREHOUSE as Address,
    votingStrategy: GovernanceV3Ethereum.VOTING_STRATEGY as Address,
  },
  137: {
    chainId: 137,
    name: 'polygon',
    governance: GovernanceV3Ethereum.GOVERNANCE as Address,
    votingPortal: GovernanceV3Ethereum.VOTING_PORTAL_ETH_POL as Address,
    votingMachine: GovernanceV3Polygon.VOTING_MACHINE as Address,
    dataWarehouse: GovernanceV3Polygon.DATA_WAREHOUSE as Address,
    votingStrategy: GovernanceV3Polygon.VOTING_STRATEGY as Address,
  },
  43114: {
    chainId: 43114,
    name: 'avalanche',
    governance: GovernanceV3Ethereum.GOVERNANCE as Address,
    votingPortal: GovernanceV3Ethereum.VOTING_PORTAL_ETH_AVAX as Address,
    votingMachine: GovernanceV3Avalanche.VOTING_MACHINE as Address,
    dataWarehouse: GovernanceV3Avalanche.DATA_WAREHOUSE as Address,
    votingStrategy: GovernanceV3Avalanche.VOTING_STRATEGY as Address,
  },
};

export type ExecutionChainConfig = {
  chainId: number;
  name: string;
  payloadsController: Address;
};

/**
 * Execution chains where PayloadsController is deployed and payloads can be executed.
 * Mirrors cre/automation/config.production.json plus the voting chains (which also
 * host their own PayloadsController).
 */
export const EXECUTION_CHAINS: Record<number, ExecutionChainConfig> = {
  [GovernanceV3Ethereum.CHAIN_ID]: {
    chainId: GovernanceV3Ethereum.CHAIN_ID,
    name: 'ethereum',
    payloadsController: GovernanceV3Ethereum.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Polygon.CHAIN_ID]: {
    chainId: GovernanceV3Polygon.CHAIN_ID,
    name: 'polygon',
    payloadsController: GovernanceV3Polygon.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Avalanche.CHAIN_ID]: {
    chainId: GovernanceV3Avalanche.CHAIN_ID,
    name: 'avalanche',
    payloadsController: GovernanceV3Avalanche.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Arbitrum.CHAIN_ID]: {
    chainId: GovernanceV3Arbitrum.CHAIN_ID,
    name: 'arbitrum',
    payloadsController: GovernanceV3Arbitrum.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Optimism.CHAIN_ID]: {
    chainId: GovernanceV3Optimism.CHAIN_ID,
    name: 'optimism',
    payloadsController: GovernanceV3Optimism.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Base.CHAIN_ID]: {
    chainId: GovernanceV3Base.CHAIN_ID,
    name: 'base',
    payloadsController: GovernanceV3Base.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3BNB.CHAIN_ID]: {
    chainId: GovernanceV3BNB.CHAIN_ID,
    name: 'bnb',
    payloadsController: GovernanceV3BNB.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Gnosis.CHAIN_ID]: {
    chainId: GovernanceV3Gnosis.CHAIN_ID,
    name: 'gnosis',
    payloadsController: GovernanceV3Gnosis.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Metis.CHAIN_ID]: {
    chainId: GovernanceV3Metis.CHAIN_ID,
    name: 'metis',
    payloadsController: GovernanceV3Metis.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Scroll.CHAIN_ID]: {
    chainId: GovernanceV3Scroll.CHAIN_ID,
    name: 'scroll',
    payloadsController: GovernanceV3Scroll.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Celo.CHAIN_ID]: {
    chainId: GovernanceV3Celo.CHAIN_ID,
    name: 'celo',
    payloadsController: GovernanceV3Celo.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Linea.CHAIN_ID]: {
    chainId: GovernanceV3Linea.CHAIN_ID,
    name: 'linea',
    payloadsController: GovernanceV3Linea.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Mantle.CHAIN_ID]: {
    chainId: GovernanceV3Mantle.CHAIN_ID,
    name: 'mantle',
    payloadsController: GovernanceV3Mantle.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Ink.CHAIN_ID]: {
    chainId: GovernanceV3Ink.CHAIN_ID,
    name: 'ink',
    payloadsController: GovernanceV3Ink.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Plasma.CHAIN_ID]: {
    chainId: GovernanceV3Plasma.CHAIN_ID,
    name: 'plasma',
    payloadsController: GovernanceV3Plasma.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3MegaEth.CHAIN_ID]: {
    chainId: GovernanceV3MegaEth.CHAIN_ID,
    name: 'megaeth',
    payloadsController: GovernanceV3MegaEth.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Soneium.CHAIN_ID]: {
    chainId: GovernanceV3Soneium.CHAIN_ID,
    name: 'soneium',
    payloadsController: GovernanceV3Soneium.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3Sonic.CHAIN_ID]: {
    chainId: GovernanceV3Sonic.CHAIN_ID,
    name: 'sonic',
    payloadsController: GovernanceV3Sonic.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3XLayer.CHAIN_ID]: {
    chainId: GovernanceV3XLayer.CHAIN_ID,
    name: 'xlayer',
    payloadsController: GovernanceV3XLayer.PAYLOADS_CONTROLLER as Address,
  },
  [GovernanceV3ZkSync.CHAIN_ID]: {
    chainId: GovernanceV3ZkSync.CHAIN_ID,
    name: 'zksync',
    payloadsController: GovernanceV3ZkSync.PAYLOADS_CONTROLLER as Address,
  },
};

/** Tokens whose storage roots must be registered for voting power calculation. */
export type GovernanceTokens = {
  aave: Address;
  aAave: Address;
  stkAave: Address;
};

// L1 token addresses (constant — voting power is always computed against L1 storage).
export const GOVERNANCE_TOKENS: GovernanceTokens = {
  aave: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  aAave: '0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9',
  stkAave: '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
};

/** stkAAVE exchange-rate storage slot (consumed by VotingStrategy.getVotingPower). */
export const STK_AAVE_EXCHANGE_RATE_SLOT: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000051';

export const findVotingChainByPortal = (portal: Address): VotingChainConfig | undefined => {
  const lower = portal.toLowerCase();
  return Object.values(VOTING_CHAINS).find((c) => c.votingPortal.toLowerCase() === lower);
};
