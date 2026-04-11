/**
 * Mock for react-native-audio-api
 *
 * Models the subset of the API used by PlaybackEngine and NotificationBridge.
 * All native round-trips are replaced with synchronous jest.fn() stubs or
 * Promise.resolve() so tests run in Node without any native module.
 *
 * Key design decisions:
 *
 *  - MockAudioContext.currentTime is a plain number that tests can advance
 *    manually via `ctx.advanceTime(n)` to simulate elapsed playback time.
 *
 *  - MockAudioContext.state starts as 'running'. Calling suspend() flips it
 *    to 'suspended'; resume() flips it back. Both return Promise.resolve().
 *
 *  - createStreamer() returns a MockStreamerNode by default. Tests that want
 *    to simulate a non-FFmpeg build can call
 *    `MockAudioContext.setStreamerAvailable(false)` before constructing the
 *    engine.
 *
 *  - Every node class exposes its jest.fn() stubs as public properties so
 *    tests can assert on calls (e.g. `streamer.initialize.mock.calls`).
 */

// ---------------------------------------------------------------------------
// Shared state — reset between tests via jest.resetModules() + clearMocks
// ---------------------------------------------------------------------------

let _streamerAvailable = true;

/** Call in a test to simulate a non-FFmpeg build (createStreamer returns null). */
export function setStreamerAvailable(available: boolean): void {
  _streamerAvailable = available;
}

// ---------------------------------------------------------------------------
// MockGainNode
// ---------------------------------------------------------------------------

export class MockGainNode {
  connect = jest.fn();
  disconnect = jest.fn();
}

// ---------------------------------------------------------------------------
// MockStreamerNode
// ---------------------------------------------------------------------------

export class MockStreamerNode {
  connect = jest.fn();
  disconnect = jest.fn();
  /** initialize() returns true (success) by default. Tests can override. */
  initialize = jest.fn().mockReturnValue(true);
  start = jest.fn();
  stop = jest.fn();
}

// Re-export alias
export { MockStreamerNode as StreamerNode };

// ---------------------------------------------------------------------------
// MockAudioContext
// ---------------------------------------------------------------------------

/**
 * Tracks the last created context so tests can access it without
 * threading through constructor arguments.
 */
let _lastContext: MockAudioContext | null = null;
export function getLastAudioContext(): MockAudioContext | null {
  return _lastContext;
}

/**
 * Tracks every StreamerNode created via createStreamer() so tests can grab
 * the instance and simulate events on it.
 */
const _createdStreamers: MockStreamerNode[] = [];
export function getCreatedStreamers(): MockStreamerNode[] {
  return _createdStreamers;
}
export function clearCreatedStreamers(): void {
  _createdStreamers.length = 0;
}

export class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime: number = 0;
  readonly destination = {};
  readonly sampleRate = 44100;

  // A gain node returned by createGain() — tests can access via getLastAudioContext()
  readonly _gainNode = new MockGainNode();

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    _lastContext = this;
  }

  /** Advance currentTime by `seconds` — simulates elapsed playback time. */
  advanceTime(seconds: number): void {
    this.currentTime += seconds;
  }

  createGain(): MockGainNode {
    return this._gainNode;
  }

  createStreamer(): MockStreamerNode | null {
    if (!_streamerAvailable) return null;
    const node = new MockStreamerNode();
    _createdStreamers.push(node);
    return node;
  }

  suspend(): boolean {
    this.state = 'suspended';
    return true;
  }

  resume(): boolean {
    this.state = 'running';
    return true;
  }

  close(): void {
    this.state = 'closed';
  }
}

// Re-export alias
export { MockAudioContext as AudioContext };

// ---------------------------------------------------------------------------
// PlaybackNotificationManager
// ---------------------------------------------------------------------------

export const PlaybackNotificationManager = {
  enableControl: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  hide: jest.fn().mockResolvedValue(undefined),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
};
