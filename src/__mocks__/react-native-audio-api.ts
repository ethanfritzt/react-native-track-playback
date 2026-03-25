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
 *  - decodeAudioData resolves with a MockAudioBuffer whose duration is
 *    controllable via the exported `setNextDecodeDuration` helper.
 *
 *  - Every node class exposes its jest.fn() stubs as public properties so
 *    tests can assert on calls (e.g. `streamer.initialize.mock.calls`).
 */

// ---------------------------------------------------------------------------
// Shared state — reset between tests via jest.resetModules() + clearMocks
// ---------------------------------------------------------------------------

let _streamerAvailable = true;
let _nextDecodeDuration = 30; // seconds

/** Call in a test to simulate a non-FFmpeg (buffer-only) build. */
export function setStreamerAvailable(available: boolean): void {
  _streamerAvailable = available;
}

/** Control the duration returned by the next decodeAudioData call. */
export function setNextDecodeDuration(seconds: number): void {
  _nextDecodeDuration = seconds;
}

// ---------------------------------------------------------------------------
// MockAudioBuffer
// ---------------------------------------------------------------------------

export class MockAudioBuffer {
  readonly duration: number;
  readonly numberOfChannels: number = 2;
  readonly length: number;
  readonly sampleRate: number = 44100;

  constructor(duration = _nextDecodeDuration) {
    this.duration = duration;
    this.length = Math.floor(duration * this.sampleRate);
  }
}

// Re-export as AudioBuffer type alias so PlaybackEngine's `type AudioBuffer`
// import resolves to this class in tests.
export { MockAudioBuffer as AudioBuffer };

// ---------------------------------------------------------------------------
// MockGainNode
// ---------------------------------------------------------------------------

export class MockGainNode {
  connect = jest.fn();
  disconnect = jest.fn();
}

// ---------------------------------------------------------------------------
// MockAudioBufferSourceNode
// ---------------------------------------------------------------------------

export class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
  onEnded: ((...args: unknown[]) => void) | null = null;

  /** Simulate natural track end — fires onEnded if wired. */
  simulateEnded(): void {
    this.onEnded?.();
  }
}

// Re-export alias
export { MockAudioBufferSourceNode as AudioBufferSourceNode };

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

/**
 * Tracks every AudioBufferSourceNode created via createBufferSource() so
 * tests can grab the instance and simulate events.
 */
const _createdSources: MockAudioBufferSourceNode[] = [];
export function getCreatedSources(): MockAudioBufferSourceNode[] {
  return _createdSources;
}
export function clearCreatedSources(): void {
  _createdSources.length = 0;
}

export class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime: number = 0;
  readonly destination = {};
  readonly sampleRate = 44100;

  // A gain node returned by createGain() — tests can access via getLastAudioContext()
  readonly _gainNode = new MockGainNode();

  constructor() {
    _lastContext = this;
  }

  /** Advance currentTime by `seconds` — simulates elapsed playback time. */
  advanceTime(seconds: number): void {
    this.currentTime += seconds;
  }

  createGain(): MockGainNode {
    return this._gainNode;
  }

  createBufferSource(): MockAudioBufferSourceNode {
    const node = new MockAudioBufferSourceNode();
    _createdSources.push(node);
    return node;
  }

  createStreamer(): MockStreamerNode | null {
    if (!_streamerAvailable) return null;
    const node = new MockStreamerNode();
    _createdStreamers.push(node);
    return node;
  }

  async suspend(): Promise<boolean> {
    this.state = 'suspended';
    return true;
  }

  async resume(): Promise<boolean> {
    this.state = 'running';
    return true;
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

// Re-export alias
export { MockAudioContext as AudioContext };

// ---------------------------------------------------------------------------
// decodeAudioData
// ---------------------------------------------------------------------------

export const decodeAudioData = jest.fn(
  async (_url: string): Promise<MockAudioBuffer> => {
    return new MockAudioBuffer(_nextDecodeDuration);
  }
);

// ---------------------------------------------------------------------------
// PlaybackNotificationManager
// ---------------------------------------------------------------------------

export const PlaybackNotificationManager = {
  enableControl: jest.fn().mockResolvedValue(undefined),
  show: jest.fn().mockResolvedValue(undefined),
  hide: jest.fn().mockResolvedValue(undefined),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
};
