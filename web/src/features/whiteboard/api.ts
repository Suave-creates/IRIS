import type {
  AddWhiteboardByRefInput,
  AddWhiteboardItemInput,
  UpdateWhiteboardItemInput,
  WhiteboardAiInput,
  WhiteboardItem,
} from '@iris/shared';
import { api } from '@/lib/api';

export const whiteboardApi = {
  list: () => api.get<WhiteboardItem[]>('/whiteboard'),
  add: (input: AddWhiteboardItemInput) => api.post<WhiteboardItem>('/whiteboard/items', input),
  addByRef: (input: AddWhiteboardByRefInput) => api.post<WhiteboardItem>('/whiteboard/items/by-ref', input),
  update: (id: string, patch: UpdateWhiteboardItemInput) =>
    api.patch<WhiteboardItem>(`/whiteboard/items/${id}`, patch),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/whiteboard/items/${id}`),
  ai: (input: WhiteboardAiInput) => api.post<WhiteboardItem>('/whiteboard/ai', input),
};
