import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Meeting, ProcessedMeeting } from '@iris/shared';
import { meetingsApi } from './api';

export const meetingsKey = ['meetings'] as const;

/**
 * The list carries everything the rows + summary/actions/context tabs need, but
 * NOT transcript lines (kept out server-side to stay fast). Search filters it
 * client-side for instant results.
 */
export function useMeetings() {
  return useQuery({ queryKey: meetingsKey, queryFn: () => meetingsApi.list() });
}

/**
 * Full detail for one meeting — including the transcript the list omits. The
 * modal uses this to load the Transcript tab on demand.
 */
export function useMeeting(id: string | null | undefined) {
  return useQuery({
    queryKey: ['meeting', id] as const,
    queryFn: () => meetingsApi.get(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/**
 * Shared cache behavior for both finalize paths: the processed meeting is
 * prepended to the cached list — replacing any earlier run of the same
 * recording, since re-recording the demo replaces it server-side. Settling
 * invalidates both meetings and people: every processed meeting boosts its
 * participants' engagement in People & Context.
 */
function processedCacheOptions(qc: QueryClient) {
  return {
    onSuccess: (result: ProcessedMeeting) => {
      const processed = result.meeting;
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) => [
        processed,
        ...(prev ?? []).filter((m) => m.id !== processed.id),
      ]);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingsKey });
      void qc.invalidateQueries({ queryKey: ['people'] });
    },
  };
}

/** Finalizes a recording from the live browser transcript (JSON path). */
export function useProcessRecording() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: meetingsApi.process, ...processedCacheOptions(qc) });
}

/**
 * Finalizes a recording from captured audio (multipart path): the server
 * transcribes with Whisper before extraction. Same cache behavior as the
 * JSON path.
 */
export function useProcessAudioRecording() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: meetingsApi.processAudio, ...processedCacheOptions(qc) });
}

/** Calendar meetings happening right now — polled while the view is open. */
export function useLiveMeetings() {
  return useQuery({
    queryKey: ['meetings', 'live'] as const,
    queryFn: () => meetingsApi.live(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

/** Deletes a meeting note; participants' engagement recomputes without it. */
export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meetingsApi.remove(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<Meeting[]>(meetingsKey, (prev) => prev?.filter((m) => m.id !== id) ?? []);
      void qc.invalidateQueries({ queryKey: meetingsKey });
      void qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}
