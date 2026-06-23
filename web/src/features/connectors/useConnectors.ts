import { useQuery } from '@tanstack/react-query';
import { connectorsApi } from './api';

const connectorsKey = ['connectors'] as const;

/** Lists every connector for the current tenant (cached, smooth refetch). */
export function useConnectors() {
  return useQuery({ queryKey: connectorsKey, queryFn: () => connectorsApi.list() });
}
