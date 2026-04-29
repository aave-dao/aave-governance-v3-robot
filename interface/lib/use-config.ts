'use client';

import useSWR from 'swr';

export type AppConfig = {
  mode: 'server' | 'client';
  signerAddress: string | null;
};

const fetcher = (url: string): Promise<AppConfig> => fetch(url).then((r) => r.json());

export const useConfig = (): AppConfig | undefined => {
  const { data } = useSWR<AppConfig>('/api/config', fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  return data;
};
