import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorProvider } from '@iris/shared';
import { connectorsApi } from './api';

const connectorsKey = ['connectors'] as const;

/** Lists every connector for the current tenant (cached, smooth refetch). */
export function useConnectors() {
  return useQuery({ queryKey: connectorsKey, queryFn: () => connectorsApi.list() });
}

export function useDisconnectConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: ConnectorProvider) => connectorsApi.disconnect(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorsKey }),
  });
}

export function useSyncConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: ConnectorProvider) => connectorsApi.sync(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: connectorsKey });
      qc.invalidateQueries({ queryKey: ['mail'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
    },
  });
}
