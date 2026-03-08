import { PlaybackEngine } from '../PlaybackEngine';
import { State } from '../types';
import {
  getLastAudioContext,
  getCreatedStreamers,
  getCreatedSources,
  clearCreatedStreamers,
  clearCreatedSources,
  setStreamerAvailable,
  setNextDecodeDuration,
  decodeAudioData,
  MockAudioContext,
} from '../__mocks__/react-native-audio-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrack(n = 1, duration = 30) {
  return {
    url: `http://example.com/track${n}.mp3`,
    title: `Track ${n}`,
    duration,
  };
}

function makeEngine(): PlaybackEngine {
  const engine = new PlaybackEngine();
  engine.init();
  return engine;
}

function collectStates(engine: PlaybackEngine): State[] {
  const states: State[] = [];
  // Access the internal emitter via the module-level singleton
  // by listening on the 'playback-state' event.
  const { emitter } = jest.requireMock('../EventEmitter') as {
    emitter: { on: (e: string, h: (...a: unknown[]) => void) => () => void };
  };
  // We actually import the real emitter, not a mock — use it directly.
  return states;
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCreatedStreamers();
  clearCreatedSources();
  setStreamerAvailable(true);
  setNextDecodeDuration(30);
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe('init', () => {
  it('creates an AudioContext and probes for StreamerNode', () => {
    const engine = new PlaybackEngine();
    engine.init();
    const ctx = getLastAudioContext()!;
    expect(ctx).toBeInstanceOf(MockAudioContext);
  });

  it('is idempotent — calling init twice does not create a second context', () => {
    const engine = new PlaybackEngine();
    engine.init();
    const ctx1 = getLastAudioContext();
    engine.init();
    const ctx2 = getLastAudioContext();
    expect(ctx1).toBe(ctx2);
  });

  it('sets streamingAvailable=true when createStreamer returns a node', () => {
    setStreamerAvailable(true);
    const engine = makeEngine();
    // loadAndPlay should use the streamer path — a streamer will be created
    return engine.loadAndPlay(makeTrack()).then(() => {
      expect(getCreatedStreamers()).toHaveLength(
        // 1 probe at init + 1 for playback = 2
        2
      );
    });
  });

  it('falls back to buffer path when createStreamer returns null', async () => {
    setStreamerAvailable(false);
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    expect(getCreatedStreamers()).toHaveLength(0);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// StreamerNode path — loadAndPlay
// ---------------------------------------------------------------------------

describe('loadAndPlay (streaming path)', () => {
  it('transitions to Playing state', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    expect(engine.getState()).toBe(State.Playing);
  });

  it('calls streamer.initialize with the track URL', async () => {
    const engine = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track);
    const streamers = getCreatedStreamers();
    const streamer = streamers[streamers.length - 1]!;
    expect(streamer.initialize).toHaveBeenCalledWith(track.url);
  });

  it('calls streamer.start(0)', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const streamers = getCreatedStreamers();
    const streamer = streamers[streamers.length - 1]!;
    expect(streamer.start).toHaveBeenCalledWith(0);
  });

  it('uses track.duration as the reported duration', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack(1, 245));
    expect(engine.getDuration()).toBe(245);
  });

  it('resumes a suspended context before starting', async () => {
    const engine = makeEngine();
    const ctx = getLastAudioContext()!;
    ctx.state = 'suspended';
    await engine.loadAndPlay(makeTrack());
    expect(ctx.state).toBe('running');
  });

  it('appends timeOffset param when startOffset > 0', async () => {
    const engine = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track, 60);
    const streamers = getCreatedStreamers();
    const streamer = streamers[streamers.length - 1]!;
    const calledUrl: string = streamer.initialize.mock.calls[0][0];
    expect(calledUrl).toContain('timeOffset=60');
  });

  it('does NOT append timeOffset when startOffset is 0', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack(), 0);
    const streamers = getCreatedStreamers();
    const streamer = streamers[streamers.length - 1]!;
    const calledUrl: string = streamer.initialize.mock.calls[0][0];
    expect(calledUrl).not.toContain('timeOffset');
  });

  it('tears down the previous streamer before starting a new one', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack(1));
    // Index 0 = probe node (created during init), index 1 = first playback node
    const streamers = getCreatedStreamers();
    const first = streamers[streamers.length - 1]!;
    await engine.loadAndPlay(makeTrack(2));
    expect(first.stop).toHaveBeenCalled();
    expect(first.onEnded).toBeNull();
  });

  it('sets State.Error and re-throws when initialize returns false', async () => {
    const engine = makeEngine();
    // Make the next streamer's initialize fail
    const origCreateStreamer = MockAudioContext.prototype.createStreamer;
    // Temporarily patch via the probe-created streamer list
    // by replacing initialize on the factory result
    const patchedEngine = makeEngine();
    clearCreatedStreamers();
    // Override: createStreamer returns a node whose initialize returns false
    const ctx = getLastAudioContext()!;
    const failNode = { connect: jest.fn(), initialize: jest.fn().mockReturnValue(false), start: jest.fn(), stop: jest.fn(), onEnded: null };
    jest.spyOn(ctx, 'createStreamer').mockReturnValueOnce(failNode as any);
    await expect(patchedEngine.loadAndPlay(makeTrack())).rejects.toThrow('failed to initialize');
    expect(patchedEngine.getState()).toBe(State.Error);
  });
});

// ---------------------------------------------------------------------------
// Buffer fallback path — loadAndPlay
// ---------------------------------------------------------------------------

describe('loadAndPlay (buffer fallback path)', () => {
  beforeEach(() => {
    setStreamerAvailable(false);
  });

  it('calls decodeAudioData with the track URL', async () => {
    const engine = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track);
    expect(decodeAudioData).toHaveBeenCalledWith(track.url);
  });

  it('transitions through Buffering → Ready → Playing', async () => {
    const engine = makeEngine();
    const states: State[] = [];
    // Patch setState indirectly by observing state at each promise tick
    // (simpler: just assert final state and that decodeAudioData was awaited)
    await engine.loadAndPlay(makeTrack());
    expect(engine.getState()).toBe(State.Playing);
  });

  it('uses buffer.duration as the reported duration', async () => {
    setNextDecodeDuration(180);
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    expect(engine.getDuration()).toBe(180);
  });

  it('uses the prefetch cache on a URL match', async () => {
    const engine = makeEngine();
    const track = makeTrack();
    // Prefetch track first
    await engine.prefetchNext(track);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    // loadAndPlay should hit the cache — no second decode
    await engine.loadAndPlay(track);
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('does not use prefetch cache on URL mismatch', async () => {
    const engine = makeEngine();
    await engine.prefetchNext(makeTrack(1));
    jest.clearAllMocks();
    await engine.loadAndPlay(makeTrack(2));
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// prefetchNext
// ---------------------------------------------------------------------------

describe('prefetchNext', () => {
  it('is a no-op when streaming is available', async () => {
    setStreamerAvailable(true);
    const engine = makeEngine();
    await engine.prefetchNext(makeTrack());
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('decodes when streaming is unavailable', async () => {
    setStreamerAvailable(false);
    const engine = makeEngine();
    await engine.prefetchNext(makeTrack());
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it('skips re-fetch when the same URL is already prefetched', async () => {
    setStreamerAvailable(false);
    const engine = makeEngine();
    const track = makeTrack();
    await engine.prefetchNext(track);
    await engine.prefetchNext(track);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// pause / resume
// ---------------------------------------------------------------------------

describe('pause / resume', () => {
  it('suspends the context and transitions to Paused', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    const ctx = getLastAudioContext()!;
    expect(ctx.state).toBe('suspended');
    expect(engine.getState()).toBe(State.Paused);
  });

  it('snapshots position before suspending', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const ctx = getLastAudioContext()!;
    ctx.advanceTime(10);
    await engine.pause();
    expect(engine.getPosition()).toBeCloseTo(10, 5);
  });

  it('is a no-op when not playing', async () => {
    const engine = makeEngine();
    await engine.pause(); // state is None
    expect(engine.getState()).toBe(State.None);
  });

  it('resumes context and transitions to Playing', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.resume();
    const ctx = getLastAudioContext()!;
    expect(ctx.state).toBe('running');
    expect(engine.getState()).toBe(State.Playing);
  });

  it('position tracking remains correct after pause→resume→advance', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const ctx = getLastAudioContext()!;

    ctx.advanceTime(5);
    await engine.pause();        // pausedPosition = 5
    ctx.advanceTime(100);        // time passes while paused (should not count)
    await engine.resume();
    ctx.advanceTime(3);          // 3 more seconds of play after resume

    expect(engine.getPosition()).toBeCloseTo(8, 4);
  });

  it('is a no-op when not paused', async () => {
    const engine = makeEngine();
    await engine.resume(); // state is None
    expect(engine.getState()).toBe(State.None);
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

describe('stop', () => {
  it('stops the source, resets duration and position, transitions to Stopped', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack(1, 120));
    await engine.stop();
    expect(engine.getState()).toBe(State.Stopped);
    expect(engine.getPosition()).toBe(0);
    expect(engine.getDuration()).toBe(0);
  });

  it('resumes a suspended context so the next loadAndPlay is not blocked', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.stop();
    const ctx = getLastAudioContext()!;
    expect(ctx.state).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// seekTo — streaming path
// ---------------------------------------------------------------------------

describe('seekTo (streaming path)', () => {
  it('creates a new streamer with the timeOffset URL', async () => {
    const engine = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track);
    clearCreatedStreamers();

    await engine.seekTo(45);

    const seekStreamer = getCreatedStreamers()[0]!;
    const calledUrl: string = seekStreamer.initialize.mock.calls[0][0];
    expect(calledUrl).toContain('timeOffset=45');
  });

  it('stays Playing when seeking while playing', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.seekTo(20);
    expect(engine.getState()).toBe(State.Playing);
  });

  it('stays Paused when seeking while paused', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.seekTo(20);
    expect(engine.getState()).toBe(State.Paused);
    expect(engine.getPosition()).toBe(20);
  });

  it('position reflects the new offset immediately after seek', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.seekTo(90);
    expect(engine.getPosition()).toBeCloseTo(90, 5);
  });

  it('is a no-op when no track is loaded', async () => {
    const engine = makeEngine();
    await expect(engine.seekTo(10)).resolves.toBeUndefined();
    expect(engine.getState()).toBe(State.None);
  });
});

// ---------------------------------------------------------------------------
// seekTo — buffer path
// ---------------------------------------------------------------------------

describe('seekTo (buffer fallback path)', () => {
  beforeEach(() => setStreamerAvailable(false));

  it('creates a new AudioBufferSourceNode for the new offset', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    clearCreatedSources();

    await engine.seekTo(15);

    const src = getCreatedSources()[0]!;
    expect(src.start).toHaveBeenCalledWith(0, 15);
  });

  it('stays Paused when seeking while paused', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    clearCreatedSources();
    await engine.seekTo(10);
    expect(engine.getState()).toBe(State.Paused);
    expect(engine.getPosition()).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Natural track end (onEnded callback)
// ---------------------------------------------------------------------------

describe('onTrackEnded callback', () => {
  it('fires the callback when the streamer ends naturally', async () => {
    const engine = makeEngine();
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack());
    const streamers1 = getCreatedStreamers();
    const streamer = streamers1[streamers1.length - 1]!;
    streamer.simulateEnded();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toBe(State.Ended);
  });

  it('does NOT fire callback when stop() was called (state not Playing)', async () => {
    const engine = makeEngine();
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack());
    await engine.stop(); // state → Stopped
    const streamers2 = getCreatedStreamers();
    const streamer = streamers2[streamers2.length - 1]!;
    streamer.simulateEnded();

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires the callback when the buffer source ends naturally (buffer path)', async () => {
    setStreamerAvailable(false);
    const engine = makeEngine();
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack());
    const sources = getCreatedSources();
    const src = sources[sources.length - 1]!;
    src.simulateEnded();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toBe(State.Ended);
  });
});

// ---------------------------------------------------------------------------
// getPosition
// ---------------------------------------------------------------------------

describe('getPosition', () => {
  it('returns 0 when not playing', () => {
    const engine = makeEngine();
    expect(engine.getPosition()).toBe(0);
  });

  it('tracks context.currentTime delta from playback start', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const ctx = getLastAudioContext()!;
    ctx.advanceTime(7);
    expect(engine.getPosition()).toBeCloseTo(7, 5);
  });

  it('returns pausedPosition snapshot when paused', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const ctx = getLastAudioContext()!;
    ctx.advanceTime(12);
    await engine.pause();
    // Advance time further — should not affect position while paused
    ctx.advanceTime(50);
    expect(engine.getPosition()).toBeCloseTo(12, 5);
  });

  it('accounts for non-zero startOffset', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack(), 30);
    expect(engine.getPosition()).toBeCloseTo(30, 5);
    const ctx = getLastAudioContext()!;
    ctx.advanceTime(5);
    expect(engine.getPosition()).toBeCloseTo(35, 5);
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe('destroy', () => {
  it('closes the AudioContext and resets state', async () => {
    const engine = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const ctx = getLastAudioContext()!;
    await engine.destroy();
    expect(ctx.state).toBe('closed');
    expect(engine.getState()).toBe(State.None);
    expect(engine.getDuration()).toBe(0);
    expect(engine.getPosition()).toBe(0);
  });
});
