import type { LiveMeeting, Meeting, ProcessedMeeting, RecordingInput } from '@iris/shared';
import { api, apiUpload } from '@/lib/api';

export const meetingsApi = {
  /** Lists meetings; `q` runs the server-side search (title/topics/participants/summary). */
  list: (q?: string) => api.get<Meeting[]>(q ? `/meetings?q=${encodeURIComponent(q)}` : '/meetings'),
  get: (id: string) => api.get<Meeting>(`/meetings/${id}`),
  /** Calendar meetings happening right now (drives the detection banner). */
  live: () => api.get<LiveMeeting[]>('/meetings/live'),
  /** Finalizes a recording: live transcript in → fully processed meeting out. */
  process: (input: RecordingInput) => api.post<ProcessedMeeting>('/meetings', input),
  /**
   * Finalizes a recording from real audio: multipart `mic` (+ optional `call`)
   * webm files in → server-side Whisper transcription → processed meeting out.
   */
  processAudio: (form: FormData) => apiUpload<ProcessedMeeting>('/meetings/audio', form),
  /** Live near-real-time transcription of one short audio segment (drives the recording feed). */
  transcribeChunk: (form: FormData) => apiUpload<{ text: string }>('/meetings/transcribe-chunk', form),
  /** Deletes a meeting note (transcript, actions, engagement events cascade). */
  remove: (id: string) => api.delete<{ ok: boolean }>(`/meetings/${id}`),
};
