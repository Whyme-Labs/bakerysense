export type SSEEvent = { type: string; [k: string]: unknown };

export function subscribe(
  url: string,
  onEvent: (ev: SSEEvent) => void,
  onClose?: () => void,
): () => void {
  const src = new EventSource(url, { withCredentials: true });
  src.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as SSEEvent);
    } catch {
      /* ignore malformed */
    }
  };
  src.onerror = () => {
    src.close();
    onClose?.();
  };
  return () => src.close();
}
