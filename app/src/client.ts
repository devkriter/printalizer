// Talks to the geometry worker: one promise per request, with progress text along the way.
import type { Request, Response, WorkerMessage } from './protocol.ts';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let next = 1;
const waiting = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void; progress?: (t: string) => void }>();

worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const m = e.data;
  const w = waiting.get(m.id);
  if (!w) return;
  if ('progress' in m) { w.progress?.(m.progress); return; }
  waiting.delete(m.id);
  if (m.ok) w.resolve(m.result);
  else w.reject(new Error(m.error));
};
worker.onerror = (e) => {
  for (const w of waiting.values()) w.reject(new Error(e.message || 'The geometry worker stopped.'));
  waiting.clear();
};

export function ask(req: Request, progress?: (text: string) => void, transfer: Transferable[] = []): Promise<Response> {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, progress });
    worker.postMessage({ id, req }, transfer);
  });
}
