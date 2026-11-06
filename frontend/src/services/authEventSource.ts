import type { apiClient } from '@/lib/api';

type StreamClient = Pick<typeof apiClient, 'openStream'>;

const DEFAULT_RECONNECT_DELAY_MS = 3000;
const LINE_BREAK = /\r\n|\r|\n/;

export class AuthEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState: number = AuthEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private readonly client: StreamClient;
  private readonly endpoint: string;
  private readonly controller = new AbortController();
  private lastEventId = '';
  private reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: StreamClient, endpoint: string) {
    super();
    this.client = client;
    this.endpoint = endpoint;
    this.addEventListener('open', () => this.onopen?.());
    this.addEventListener('error', () => this.onerror?.());
    void this.connect();
  }

  close(): void {
    this.readyState = AuthEventSource.CLOSED;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.controller.abort();
  }

  private async connect(): Promise<void> {
    let response: Response;
    try {
      response = await this.client.openStream(this.endpoint, this.controller.signal);
    } catch {
      this.reconnect();
      return;
    }
    if (this.readyState === AuthEventSource.CLOSED) return;

    const contentType = response.headers.get('Content-Type') ?? '';
    if (!response.ok || !response.body || !contentType.startsWith('text/event-stream')) {
      this.fail();
      return;
    }

    this.readyState = AuthEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
    await this.read(response.body).catch(() => undefined);
    this.reconnect();
  }

  private reconnect(): void {
    if (this.readyState === AuthEventSource.CLOSED) return;
    this.readyState = AuthEventSource.CONNECTING;
    this.dispatchEvent(new Event('error'));
    if (this.readyState === AuthEventSource.CLOSED) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelayMs);
  }

  private fail(): void {
    if (this.readyState === AuthEventSource.CLOSED) return;
    this.close();
    this.dispatchEvent(new Event('error'));
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let data = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let match = LINE_BREAK.exec(buffer);
      while (match && !(match[0] === '\r' && match.index === buffer.length - 1)) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (line === '') {
          if (this.readyState === AuthEventSource.CLOSED) return;
          if (data) {
            this.dispatchEvent(
              new MessageEvent(eventType || 'message', {
                data: data.slice(0, -1),
                lastEventId: this.lastEventId,
              }),
            );
          }
          eventType = '';
          data = '';
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let fieldValue = colon === -1 ? '' : line.slice(colon + 1);
          if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);

          if (field === 'event') {
            eventType = fieldValue;
          } else if (field === 'data') {
            data += `${fieldValue}\n`;
          } else if (field === 'id' && !fieldValue.includes('\0')) {
            this.lastEventId = fieldValue;
          } else if (field === 'retry' && /^\d+$/.test(fieldValue)) {
            this.reconnectDelayMs = Number(fieldValue);
          }
        }

        match = LINE_BREAK.exec(buffer);
      }
    }
  }
}
