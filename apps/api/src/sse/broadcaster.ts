// Tiny SSE pub/sub. Subscribers register a callback; the broadcaster
// fans an event out to every subscriber. Designed to stay out of the
// way: a single `EventEmitter` would also work, but this wrapper gives
// us typed event names and a `close()` hook for HTTP responses.

import { EventEmitter } from "node:events";

export type SseEvent =
  | { type: "vote"; delta: number; current: number; observedAt: string }
  | { type: "credits"; balance: number; blocked: boolean }
  | { type: "ping"; ts: number };

type Listener = (event: SseEvent) => void;

class Broadcaster {
  private readonly bus = new EventEmitter();

  constructor() {
    // SSE clients can be many; the default 10-listener cap would warn.
    this.bus.setMaxListeners(1000);
  }

  subscribe(listener: Listener): () => void {
    this.bus.on("event", listener);
    return () => this.bus.off("event", listener);
  }

  publish(event: SseEvent): void {
    this.bus.emit("event", event);
  }

  /** Test helper. */
  listenerCount(): number {
    return this.bus.listenerCount("event");
  }
}

// Single shared instance for the whole process. Tests can import it
// and inspect listenerCount() if they need to.
export const broadcaster = new Broadcaster();
