'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from 'viem';
import * as viemChains from 'viem/chains';

type Eip1193 = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type WalletState = {
  available: boolean;
  account: Address | null;
  chainId: number | null;
};

type WalletApi = WalletState & {
  connect: () => Promise<Address | null>;
  /** Switch (or add+switch) the wallet to the requested chainId. */
  switchChain: (chainId: number) => Promise<void>;
  /** Submit a tx with the connected wallet. Auto-switches chain if needed. */
  sendTx: (tx: { to: Address; data: Hex; value?: bigint; chainId: number }) => Promise<Hex>;
};

const WalletCtx = createContext<WalletApi | null>(null);

const getProvider = (): Eip1193 | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
};

const viemChainByChainId = (chainId: number): Chain | undefined => {
  for (const v of Object.values(viemChains)) {
    if (v && typeof v === 'object' && 'id' in (v as object) && (v as Chain).id === chainId) {
      return v as Chain;
    }
  }
  return undefined;
};

const synthChain = (chainId: number): Chain => ({
  id: chainId,
  name: `chain-${chainId}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [] } },
});

const toHexChainId = (chainId: number): Hex => `0x${chainId.toString(16)}` as Hex;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    available: false,
    account: null,
    chainId: null,
  });

  // Detect provider + restore connection if previously authorized.
  useEffect(() => {
    const provider = getProvider();
    if (!provider) {
      setState((s) => ({ ...s, available: false }));
      return;
    }
    let cancelled = false;
    const init = async () => {
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as Address[];
        const chainHex = (await provider.request({ method: 'eth_chainId' })) as Hex;
        if (cancelled) return;
        setState({
          available: true,
          account: accounts[0] ?? null,
          chainId: chainHex ? Number.parseInt(chainHex, 16) : null,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, available: true }));
      }
    };
    init();

    const onAccounts = (accounts: unknown) => {
      const arr = accounts as Address[];
      setState((s) => ({ ...s, account: arr[0] ?? null }));
    };
    const onChain = (chainHex: unknown) => {
      const c = typeof chainHex === 'string' ? Number.parseInt(chainHex, 16) : null;
      setState((s) => ({ ...s, chainId: c }));
    };
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      cancelled = true;
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const connect = useCallback(async (): Promise<Address | null> => {
    const provider = getProvider();
    if (!provider) return null;
    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
    })) as Address[];
    const chainHex = (await provider.request({ method: 'eth_chainId' })) as Hex;
    const next: WalletState = {
      available: true,
      account: accounts[0] ?? null,
      chainId: chainHex ? Number.parseInt(chainHex, 16) : null,
    };
    setState(next);
    return next.account;
  }, []);

  const switchChain = useCallback(async (chainId: number) => {
    const provider = getProvider();
    if (!provider) throw new Error('No browser wallet available');
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChainId(chainId) }],
      });
    } catch (err) {
      // 4902 → chain not added; try to add then switch.
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        const chain = viemChainByChainId(chainId);
        if (chain) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: toHexChainId(chainId),
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: chain.rpcUrls.default.http,
                blockExplorerUrls: chain.blockExplorers?.default
                  ? [chain.blockExplorers.default.url]
                  : [],
              },
            ],
          });
          return;
        }
      }
      throw err;
    }
  }, []);

  const sendTx = useCallback(
    async ({ to, data, value, chainId }: { to: Address; data: Hex; value?: bigint; chainId: number }): Promise<Hex> => {
      const provider = getProvider();
      if (!provider) throw new Error('No browser wallet available');
      const accounts = (await provider.request({ method: 'eth_accounts' })) as Address[];
      let from = accounts[0];
      if (!from) {
        const requested = (await provider.request({
          method: 'eth_requestAccounts',
        })) as Address[];
        from = requested[0];
      }
      if (!from) throw new Error('No account in wallet');

      // Make sure the wallet is on the right chain before sending.
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as Hex;
      if (Number.parseInt(currentChain, 16) !== chainId) {
        await switchChain(chainId);
      }

      const chain = viemChainByChainId(chainId) ?? synthChain(chainId);
      const wc: WalletClient = createWalletClient({
        account: from,
        chain,
        transport: custom(provider),
      });
      // sendTransaction returns the tx hash.
      const txHash = await wc.sendTransaction({
        account: from,
        to,
        data,
        value: value ?? 0n,
        chain,
      });
      return txHash;
    },
    [switchChain],
  );

  const api = useMemo<WalletApi>(
    () => ({ ...state, connect, switchChain, sendTx }),
    [state, connect, switchChain, sendTx],
  );

  return <WalletCtx.Provider value={api}>{children}</WalletCtx.Provider>;
}

const NOOP: WalletApi = {
  available: false,
  account: null,
  chainId: null,
  connect: async () => null,
  switchChain: async () => {},
  sendTx: async () => {
    throw new Error('Wallet provider not mounted');
  },
};

export function useWallet(): WalletApi {
  return useContext(WalletCtx) ?? NOOP;
}

// `createPublicClient`/`http` are imported only so the dynamic-chain fallback can resolve when
// viem is bundled standalone. Safe to keep — tree-shaken otherwise.
void createPublicClient;
void http;
