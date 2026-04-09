import { PlaybackEngine } from '../PlaybackEngine';
import { State } from '../types';
import type {
  AudioBuffer,
  AudioBufferSourceNode,
  GainNode,
  PlaybackAudioApi,
  PlaybackAudioContext,
  StreamerNode,
} from '../audioContext';

type TestDestination = PlaybackAudioContext['destination'];

class TestAudioBuffer {
  readonly numberOfChannels = 2;
  readonly sampleRate = 44100;
  readonly length: number;

  constructor(public readonly duration: number) {
    this.length = Math.floor(duration * this.sampleRate);
  }
}

class TestGainNode implements Partial<GainNode> {
  connect = jest.fn();
  disconnect = jest.fn();
}

class TestAudioBufferSourceNode {
  buffer: AudioBuffer | null = null;
  connect = jest.fn();
  disconnect = jest.fn();
  start = jest.fn();
  stop = jest.fn();
  onEnded?: (...args: unknown[]) => void;

  simulateEnded(): void {
    this.onEnded?.();
  }
}

class TestStreamerNode {
  connect = jest.fn();
  disconnect = jest.fn();
  initialize = jest.fn().mockReturnValue(true);
  start = jest.fn();
  stop = jest.fn();
}

class TestAudioContext implements PlaybackAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  readonly destination = {} as TestDestination;
  readonly gainNode = new TestGainNode();
  readonly createdStreamers: TestStreamerNode[] = [];
  readonly createdSources: TestAudioBufferSourceNode[] = [];
  streamerAvailable = true;

  advanceTime(seconds: number): void {
    this.currentTime += seconds;
  }

  createGain(): GainNode {
    return this.gainNode as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    const node = new TestAudioBufferSourceNode();
    this.createdSources.push(node);
    return node as unknown as AudioBufferSourceNode;
  }

  createStreamer(): StreamerNode | null {
    if (!this.streamerAvailable) return null;
    const node = new TestStreamerNode();
    this.createdStreamers.push(node);
    return node as unknown as StreamerNode;
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

function makeTrack(n = 1, duration = 30) {
  return {
    url: `http://example.com/track${n}.mp3`,
    title: `Track ${n}`,
    duration,
  };
}

function makeEngine(options?: {
  streamerAvailable?: boolean;
  decodeDuration?: number;
  decodeImpl?: (url: string) => AudioBuffer | Promise<AudioBuffer>;
}) {
  const context = new TestAudioContext();
  if (options?.streamerAvailable !== undefined) {
    context.streamerAvailable = options.streamerAvailable;
  }

  const decode = jest.fn(
    options?.decodeImpl ??
      (() => new TestAudioBuffer(options?.decodeDuration ?? 30) as unknown as AudioBuffer)
  );

  const audioApi: PlaybackAudioApi = {
    createContext: () => context,
    decode,
  };

  const engine = new PlaybackEngine(audioApi);
  engine.init();

  return { engine, context, decode };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('init', () => {
  it('creates an audio context and probes for StreamerNode', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    expect(context.createdStreamers).toHaveLength(2);
  });

  it('is idempotent, calling init twice does not create a second context', () => {
    const { engine, context } = makeEngine();
    engine.init();
    expect((engine as any).context).toBe(context);
  });

  it('falls back to buffer path when createStreamer returns null', async () => {
    const { engine, context, decode } = makeEngine({ streamerAvailable: false });
    await engine.loadAndPlay(makeTrack());
    expect(context.createdStreamers).toHaveLength(0);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe('loadAndPlay (streaming path)', () => {
  it('transitions to Playing state', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    expect(engine.getState()).toBe(State.Playing);
  });

  it('calls streamer.initialize with the track URL', async () => {
    const { engine, context } = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track);
    const streamer = context.createdStreamers[context.createdStreamers.length - 1]!;
    expect(streamer.initialize).toHaveBeenCalledWith(track.url);
  });

  it('calls streamer.start(0)', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    const streamer = context.createdStreamers[context.createdStreamers.length - 1]!;
    expect(streamer.start).toHaveBeenCalledWith(0);
  });

  it('uses track.duration as the reported duration', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack(1, 245));
    expect(engine.getDuration()).toBe(245);
  });

  it('resumes a suspended context before starting', async () => {
    const { engine, context } = makeEngine();
    context.state = 'suspended';
    await engine.loadAndPlay(makeTrack());
    expect(context.state).toBe('running');
  });

  it('appends timeOffset param when startOffset > 0', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack(), 60);
    const streamer = context.createdStreamers[context.createdStreamers.length - 1]!;
    const calledUrl: string = streamer.initialize.mock.calls[0][0];
    expect(calledUrl).toContain('timeOffset=60');
  });

  it('does not append timeOffset when startOffset is 0', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack(), 0);
    const streamer = context.createdStreamers[context.createdStreamers.length - 1]!;
    const calledUrl: string = streamer.initialize.mock.calls[0][0];
    expect(calledUrl).not.toContain('timeOffset');
  });

  it('tears down the previous streamer before starting a new one', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack(1));
    const first = context.createdStreamers[context.createdStreamers.length - 1]!;
    await engine.loadAndPlay(makeTrack(2));
    expect(first.stop).toHaveBeenCalled();
  });

  it('sets State.Error and re-throws when initialize returns false', async () => {
    const { engine, context } = makeEngine();
    const failNode = new TestStreamerNode();
    failNode.initialize.mockReturnValue(false);
    context.createStreamer = jest.fn(() => failNode as unknown as StreamerNode);

    await expect(engine.loadAndPlay(makeTrack())).rejects.toThrow('failed to initialize');
    expect(engine.getState()).toBe(State.Error);
  });
});

describe('loadAndPlay (buffer fallback path)', () => {
  it('calls decode with the track URL', async () => {
    const { engine, decode } = makeEngine({ streamerAvailable: false });
    const track = makeTrack();
    await engine.loadAndPlay(track);
    expect(decode).toHaveBeenCalledWith(track.url);
  });

  it('transitions to Playing', async () => {
    const { engine } = makeEngine({ streamerAvailable: false });
    await engine.loadAndPlay(makeTrack());
    expect(engine.getState()).toBe(State.Playing);
  });

  it('uses buffer.duration as the reported duration', async () => {
    const { engine } = makeEngine({ streamerAvailable: false, decodeDuration: 180 });
    await engine.loadAndPlay(makeTrack());
    expect(engine.getDuration()).toBe(180);
  });

  it('uses the prefetch cache on a URL match', async () => {
    const { engine, decode } = makeEngine({ streamerAvailable: false });
    const track = makeTrack();
    await engine.prefetchNext(track);
    expect(decode).toHaveBeenCalledTimes(1);
    decode.mockClear();
    await engine.loadAndPlay(track);
    expect(decode).not.toHaveBeenCalled();
  });

  it('does not use prefetch cache on URL mismatch', async () => {
    const { engine, decode } = makeEngine({ streamerAvailable: false });
    await engine.prefetchNext(makeTrack(1));
    decode.mockClear();
    await engine.loadAndPlay(makeTrack(2));
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe('prefetchNext', () => {
  it('is a no-op when streaming is available', async () => {
    const { engine, decode } = makeEngine();
    await engine.prefetchNext(makeTrack());
    expect(decode).not.toHaveBeenCalled();
  });

  it('decodes when streaming is unavailable', async () => {
    const { engine, decode } = makeEngine({ streamerAvailable: false });
    await engine.prefetchNext(makeTrack());
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('skips re-fetch when the same URL is already prefetched', async () => {
    const { engine, decode } = makeEngine({ streamerAvailable: false });
    const track = makeTrack();
    await engine.prefetchNext(track);
    await engine.prefetchNext(track);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe('pause / resume', () => {
  it('suspends the context and transitions to Paused', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    expect(context.state).toBe('suspended');
    expect(engine.getState()).toBe(State.Paused);
  });

  it('snapshots position before suspending', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    context.advanceTime(10);
    await engine.pause();
    expect(engine.getPosition()).toBeCloseTo(10, 5);
  });

  it('is a no-op when not playing', async () => {
    const { engine } = makeEngine();
    await engine.pause();
    expect(engine.getState()).toBe(State.None);
  });

  it('resumes context and transitions to Playing', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.resume();
    expect(context.state).toBe('running');
    expect(engine.getState()).toBe(State.Playing);
  });

  it('position tracking remains correct after pause, resume, and advance', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    context.advanceTime(5);
    await engine.pause();
    context.advanceTime(100);
    await engine.resume();
    context.advanceTime(3);
    expect(engine.getPosition()).toBeCloseTo(8, 4);
  });

  it('is a no-op when not paused', async () => {
    const { engine } = makeEngine();
    await engine.resume();
    expect(engine.getState()).toBe(State.None);
  });
});

describe('stop', () => {
  it('stops the source, resets duration and position, transitions to Stopped', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack(1, 120));
    await engine.stop();
    expect(engine.getState()).toBe(State.Stopped);
    expect(engine.getPosition()).toBe(0);
    expect(engine.getDuration()).toBe(0);
  });

  it('resumes a suspended context so the next loadAndPlay is not blocked', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.stop();
    expect(context.state).toBe('running');
  });
});

describe('seekTo (streaming path)', () => {
  it('creates a new streamer with the timeOffset URL', async () => {
    const { engine, context } = makeEngine();
    const track = makeTrack();
    await engine.loadAndPlay(track);
    context.createdStreamers.length = 0;

    await engine.seekTo(45);

    const seekStreamer = context.createdStreamers[0]!;
    const calledUrl: string = seekStreamer.initialize.mock.calls[0][0];
    expect(calledUrl).toContain('timeOffset=45');
  });

  it('stays Playing when seeking while playing', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.seekTo(20);
    expect(engine.getState()).toBe(State.Playing);
  });

  it('stays Paused when seeking while paused', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    await engine.seekTo(20);
    expect(engine.getState()).toBe(State.Paused);
    expect(engine.getPosition()).toBe(20);
  });

  it('position reflects the new offset immediately after seek', async () => {
    const { engine } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.seekTo(90);
    expect(engine.getPosition()).toBeCloseTo(90, 5);
  });

  it('is a no-op when no track is loaded', async () => {
    const { engine } = makeEngine();
    await expect(engine.seekTo(10)).resolves.toBeUndefined();
    expect(engine.getState()).toBe(State.None);
  });
});

describe('seekTo (buffer fallback path)', () => {
  it('creates a new AudioBufferSourceNode for the new offset', async () => {
    const { engine, context } = makeEngine({ streamerAvailable: false });
    await engine.loadAndPlay(makeTrack());
    context.createdSources.length = 0;

    await engine.seekTo(15);

    const src = context.createdSources[0]!;
    expect(src.start).toHaveBeenCalledWith(0, 15);
  });

  it('stays Paused when seeking while paused', async () => {
    const { engine, context } = makeEngine({ streamerAvailable: false });
    await engine.loadAndPlay(makeTrack());
    await engine.pause();
    context.createdSources.length = 0;
    await engine.seekTo(10);
    expect(engine.getState()).toBe(State.Paused);
    expect(engine.getPosition()).toBe(10);
  });
});

describe('onTrackEnded callback', () => {
  it('fires the callback when the streamer poller detects end', async () => {
    const { engine, context } = makeEngine();
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack(1, 30));
    context.advanceTime(30);
    jest.advanceTimersByTime(250);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toBe(State.Ended);
  });

  it('does not fire callback when stop was called before poller fires', async () => {
    const { engine, context } = makeEngine();
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack(1, 30));
    await engine.stop();
    context.advanceTime(30);
    jest.advanceTimersByTime(250);

    expect(cb).not.toHaveBeenCalled();
  });

  it('fires the callback when the buffer source ends naturally in buffer mode', async () => {
    const { engine, context } = makeEngine({ streamerAvailable: false });
    const cb = jest.fn();
    engine.onTrackEnded(cb);

    await engine.loadAndPlay(makeTrack());
    const src = context.createdSources[context.createdSources.length - 1]!;
    src.simulateEnded();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toBe(State.Ended);
  });
});

describe('getPosition', () => {
  it('returns 0 when not playing', () => {
    const { engine } = makeEngine();
    expect(engine.getPosition()).toBe(0);
  });

  it('tracks context.currentTime delta from playback start', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    context.advanceTime(7);
    expect(engine.getPosition()).toBeCloseTo(7, 5);
  });

  it('returns pausedPosition snapshot when paused', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    context.advanceTime(12);
    await engine.pause();
    context.advanceTime(50);
    expect(engine.getPosition()).toBeCloseTo(12, 5);
  });

  it('accounts for non-zero startOffset', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack(), 30);
    expect(engine.getPosition()).toBeCloseTo(30, 5);
    context.advanceTime(5);
    expect(engine.getPosition()).toBeCloseTo(35, 5);
  });
});

describe('destroy', () => {
  it('closes the audio context and resets state', async () => {
    const { engine, context } = makeEngine();
    await engine.loadAndPlay(makeTrack());
    await engine.destroy();
    expect(context.state).toBe('closed');
    expect(engine.getState()).toBe(State.None);
    expect(engine.getDuration()).toBe(0);
    expect(engine.getPosition()).toBe(0);
  });
});
