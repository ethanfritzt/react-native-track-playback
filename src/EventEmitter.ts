type Handler = (...args: unknown[]) => void;

/**
 * Minimal typed event emitter used internally to decouple modules.
 * No external dependency — avoids bundling EventEmitter from Node.js.
 */
export class EventEmitter {
  private listeners: Map<string, Set<Handler>> = new Map();

  on(event: string, handler: Handler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(h => h(...args));
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

/**
 * Package-wide singleton emitter. All modules share this instance so that
 * hooks can subscribe to events emitted by TrackPlayer and PlaybackEngine
 * without prop-drilling or React context.
 */
export const emitter = new EventEmitter();
