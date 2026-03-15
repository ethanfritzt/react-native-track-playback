/**
 * Integration tests — end-to-end playback scenarios.
 *
 * These tests drive complete, real-world workflows across multiple components
 * (TrackPlayer → PlaybackEngine → QueueManager → EventEmitter →
 * NotificationBridge) using the mocked react-native-audio-api.
 *
 * They are intentionally higher-level than the unit tests in
 * TrackPlayer.test.ts: each scenario exercises several API calls in sequence,
 * verifies cross-cutting concerns (events, notifications, state, position),
 * and checks the interactions that emerge only when the full stack runs
 * together.
 *
 * Relates to issue #7.
 *
 * Known bugs proved by this suite (expected to FAIL on unfixed codebase):
 *   Bug #8  — onEnded fires twice: kills the next track
 *   Bug #9  — loadAndPlay rejection in auto-advance silently swallowed
 *   Bug #10 — seekTo with null createStreamer leaves engine in broken state
 *   Bug #11 — End-of-queue: no PlaybackActiveTrackChanged(null), no Stopped
 */

import TrackPlayer from '../TrackPlayer';
import { Event, State } from '../types';
import {
  getLastAudioContext,
  getCreatedStreamers,
  getCreatedSources,
  clearCreatedStreamers,
  clearCreatedSources,
  setStreamerAvailable,
  setNextDecodeDuration,
  decodeAudioData,
  PlaybackNotificationManager,
} from '../__mocks__/react-native-audio-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function track(n: number, duration = 60) {
  return {
    url: `http://example.com/track${n}.mp3`,
    title: `Track ${n}`,
    artist: 'Test Artist',
    album: 'Test Album',
    duration,
  };
}

async function setup() {
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({ capabilities: [] });
}

/** Returns the most recently created StreamerNode. Use for streaming-path tests only. */
function lastStreamer() {
  const s = getCreatedStreamers();
  return s[s.length - 1]!;
}

/** Returns the most recently created AudioBufferSourceNode. Use for buffer-path tests only. */
function lastSource() {
  const s = getCreatedSources();
  return s[s.length - 1]!;
}

/** Flush pending microtasks and macrotasks. */
async function flushAsync(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>(r => setImmediate(r));
  }
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCreatedStreamers();
  clearCreatedSources();
  setStreamerAvailable(true);
  setNextDecodeDuration(60);
  jest.clearAllMocks();
});

// ===========================================================================
// Scenario 1 — Full single-track lifecycle (streaming path)
// ===========================================================================

describe('Scenario 1: full single-track lifecycle (streaming path)', () => {
  it('play → seek → pause → resume → natural end fires events in the right order', async () => {
    await setup();

    const events: string[] = [];
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () =>
      events.push('trackChanged'),
    );
    TrackPlayer.addEventListener(Event.PlaybackState, (e: any) =>
      events.push(`state:${e.state}`),
    );

    await TrackPlayer.setQueue([track(1, 120)]);
    await TrackPlayer.play();

    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
    expect(events).toContain('trackChanged');

    await TrackPlayer.seekTo(45);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    await TrackPlayer.pause();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Paused });

    getLastAudioContext()!.advanceTime(30);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    await TrackPlayer.play();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    getLastAudioContext()!.advanceTime(10);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(55, 3);

    lastStreamer().simulateEnded();
    await flushAsync();

    expect(PlaybackNotificationManager.hide).toHaveBeenCalled();
  });
});

// ===========================================================================
// Scenario 2 — Full multi-track auto-advance (streaming path)
// ===========================================================================

describe('Scenario 2: full multi-track auto-advance (streaming path)', () => {
  it('advances through all 3 tracks and settles with notification hidden', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    const streamer1 = lastStreamer();
    clearCreatedStreamers();
    streamer1.simulateEnded();
    await flushAsync();

    let active = await TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    const streamer2 = lastStreamer();
    clearCreatedStreamers();
    streamer2.simulateEnded();
    await flushAsync();

    active = await TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 3');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    const streamer3 = lastStreamer();
    jest.clearAllMocks();
    streamer3.simulateEnded();
    await flushAsync();

    expect(PlaybackNotificationManager.hide).toHaveBeenCalledTimes(1);
  });

  it('emits PlaybackActiveTrackChanged with correct indices on every auto-advance', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    const changes: Array<{ index: number; lastIndex: number }> = [];
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e: any) => {
      changes.push({ index: e.index, lastIndex: e.lastIndex });
    });

    const s1 = lastStreamer();
    s1.simulateEnded();
    await flushAsync();

    const s2 = lastStreamer();
    s2.simulateEnded();
    await flushAsync();

    expect(changes[0]).toMatchObject({ index: 1, lastIndex: 0 });
    expect(changes[1]).toMatchObject({ index: 2, lastIndex: 1 });
  });
});

// ===========================================================================
// Scenario 3 — Full lifecycle (buffer fallback path)
// ===========================================================================

describe('Scenario 3: full single-track lifecycle (buffer fallback path)', () => {
  beforeEach(() => {
    setStreamerAvailable(false);
    setNextDecodeDuration(90);
  });

  it('play → pause → seek → resume → natural end works correctly', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1, 90)]);
    await TrackPlayer.play();

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    await TrackPlayer.pause();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Paused });

    await TrackPlayer.seekTo(30);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(30, 3);

    await TrackPlayer.play();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    getLastAudioContext()!.advanceTime(15);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    const progress = await TrackPlayer.getProgress();
    expect(progress.duration).toBe(90);
  });

  it('prefetches the next-next track on auto-advance and uses the cache', async () => {
    await setup();

    // Three-track queue: T1 ends → T2 starts + T3 prefetched in background
    //                    T2 ends → T3 loads from cache (no second decodeAudioData)
    await TrackPlayer.setQueue([track(1, 90), track(2, 90), track(3, 90)]);
    await TrackPlayer.play();
    expect(decodeAudioData).toHaveBeenCalledTimes(1); // T1 decoded

    // T1 ends: T2 loaded (decode T2), prefetchNext(T3) fires concurrently
    const source1 = lastSource();
    clearCreatedSources();
    source1.simulateEnded();
    await flushAsync(5); // extra rounds: decode T2 + prefetch T3 both need time

    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });

    // Clear spy — only observe what happens during T2→T3 advance
    jest.clearAllMocks();

    // T2 ends: T3 loaded from prefetch cache — no decodeAudioData call
    const source2 = lastSource();
    clearCreatedSources();
    source2.simulateEnded();
    await flushAsync(5);

    expect(decodeAudioData).not.toHaveBeenCalled(); // cache hit ✓
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 3' });
  });
});

// ===========================================================================
// Scenario 4 — Queue manipulation mid-playback
// ===========================================================================

describe('Scenario 4: queue manipulation mid-playback', () => {
  it('add() during playback is reflected in the queue immediately', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();

    await TrackPlayer.add([track(3), track(4)]);

    const q = await TrackPlayer.getQueue();
    expect(q).toHaveLength(4);
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 1' });
  });

  it('adding a track then skipping to it loads and plays it', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();

    await TrackPlayer.add([track(2)]);
    await TrackPlayer.skipToNext();

    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
  });

  it('remove() on a non-active track keeps playback running', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    await TrackPlayer.remove([2]);

    const q = await TrackPlayer.getQueue();
    expect(q).toHaveLength(2);
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 1' });
  });
});

// ===========================================================================
// Scenario 5 — Notification lifecycle across a full session
// ===========================================================================

describe('Scenario 5: notification lifecycle across a full session', () => {
  it('show is called on play, updated on seek, updated on metadata change, hidden on stop', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1, 120)]);
    await TrackPlayer.play();

    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 1' }),
    );

    jest.clearAllMocks();
    await TrackPlayer.seekTo(30);
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedTime: 30 }),
    );

    jest.clearAllMocks();
    await TrackPlayer.updateMetadataForTrack(0, { artwork: 'https://example.com/cover.jpg' });
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ artwork: 'https://example.com/cover.jpg' }),
    );

    jest.clearAllMocks();
    await TrackPlayer.stop();
    expect(PlaybackNotificationManager.hide).toHaveBeenCalledTimes(1);
  });

  it('show is called for each track on auto-advance, then hidden at end-of-queue', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();

    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 1' }),
    );

    const s1 = lastStreamer();
    jest.clearAllMocks();
    s1.simulateEnded();
    await flushAsync();

    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 2' }),
    );

    const s2 = lastStreamer();
    jest.clearAllMocks();
    s2.simulateEnded();
    await flushAsync();

    expect(PlaybackNotificationManager.hide).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Scenario 6 — Skip backward / forward edge cases
// ===========================================================================

describe('Scenario 6: skipToPrevious / skipToNext edge cases', () => {
  it('skipToNext at end of queue does not change track or state', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext();

    clearCreatedStreamers();
    await TrackPlayer.skipToNext();

    expect(getCreatedStreamers()).toHaveLength(0);
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
  });

  it('skipToPrevious >3 s in restarts current track, not the previous one', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext();

    getLastAudioContext()!.advanceTime(10);

    clearCreatedStreamers();
    await TrackPlayer.skipToPrevious();

    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPosition()).toBeCloseTo(0, 3);
  });

  it('skip forward then backward then forward emits the correct track-changed events', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    const indices: number[] = [];
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e: any) => {
      indices.push(e.index);
    });

    await TrackPlayer.skipToNext();
    await TrackPlayer.skipToNext();
    await TrackPlayer.skipToPrevious();
    await TrackPlayer.skipToPrevious();

    expect(indices).toEqual([1, 2, 1, 0]);
  });
});

// ===========================================================================
// Scenario 7 — reset() clears session completely
// ===========================================================================

describe('Scenario 7: reset() clears the entire session', () => {
  it('after reset the queue is empty, state is Stopped, and no track is active', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.reset();

    expect(await TrackPlayer.getQueue()).toHaveLength(0);
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Stopped });
    // QueueManager.getActiveTrack() returns undefined (not null) when index === -1
    expect(await TrackPlayer.getActiveTrack()).toBeUndefined();
  });

  it('after reset a new setQueue + play() starts a fresh session correctly', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.reset();

    clearCreatedStreamers();

    await TrackPlayer.setQueue([track(2), track(3)]);
    await TrackPlayer.play();

    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
    expect(getCreatedStreamers()).toHaveLength(1);
  });
});

// ===========================================================================
// Scenario 8 — Event listener cleanup
// ===========================================================================

describe('Scenario 8: event listener cleanup', () => {
  it('removed listener does not fire for any subsequent events', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);

    const handler = jest.fn();
    const sub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);

    await TrackPlayer.play();
    expect(handler).toHaveBeenCalledTimes(1);

    sub.remove();

    await TrackPlayer.skipToNext();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('multiple listeners all fire, and removing one does not affect the others', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);

    const h1 = jest.fn();
    const h2 = jest.fn();
    const sub1 = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, h1);
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, h2);

    await TrackPlayer.play();
    sub1.remove();

    await TrackPlayer.skipToNext();

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Bug #8 — onEnded double-fire  [EXPECTED TO FAIL on unfixed code]
// ===========================================================================

describe('Bug #8: onEnded double-fire', () => {
  /**
   * The native layer fires onEnded TWICE per natural completion on some
   * platforms. The second fire should be a no-op, but on unfixed code it
   * triggers a second auto-advance, killing whatever track is now playing.
   *
   * Fix: clear (null-out) the streamer's onEnded handler immediately after
   * the first fire so subsequent fires are ignored.
   */

  // BUG #8 — EXPECTED TO FAIL on unfixed code
  it('[BUG #8] second onEnded fire on the SAME streamer is a no-op', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    const streamer1 = lastStreamer();
    clearCreatedStreamers();

    streamer1.simulateEnded(); // first fire — legitimate end of Track 1
    await flushAsync();

    expect((await TrackPlayer.getActiveTrack())?.title).toBe('Track 2');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // BUG #8: second spurious fire kills Track 2 and advances to Track 3
    streamer1.simulateEnded();
    await flushAsync();

    expect((await TrackPlayer.getActiveTrack())?.title).toBe('Track 2');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
  });

  // BUG #8 — EXPECTED TO FAIL on unfixed code
  it('[BUG #8] rapid double-fire causes exactly ONE auto-advance, not two', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();

    const advancedTo: number[] = [];
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e: any) => {
      if (e.index > 0) advancedTo.push(e.index);
    });

    const streamer1 = lastStreamer();
    streamer1.simulateEnded();
    streamer1.simulateEnded(); // rapid double-fire
    await flushAsync();

    // BUG #8: on unfixed code advancedTo === [1, 2]
    expect(advancedTo).toHaveLength(1);
    expect(advancedTo[0]).toBe(1);
  });
});

// ===========================================================================
// Bug #9 — Silent error swallow on auto-advance  [EXPECTED TO FAIL on unfixed code]
// ===========================================================================

describe('Bug #9: silent error swallow on auto-advance', () => {
  /**
   * When loadAndPlay() throws during auto-advance, the error is caught and
   * discarded. No PlaybackError event is emitted, leaving the UI with stale
   * state and no user feedback.
   *
   * Fix: emit Event.PlaybackError in the catch block of the auto-advance handler.
   */

  // BUG #9 — EXPECTED TO FAIL on unfixed code
  it('[BUG #9] emits PlaybackError when loadAndPlay throws during auto-advance', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();

    const errors: unknown[] = [];
    TrackPlayer.addEventListener(Event.PlaybackError, payload => {
      errors.push(payload);
    });

    const ctx = getLastAudioContext()!;
    jest.spyOn(ctx, 'createStreamer').mockReturnValueOnce({
      connect: jest.fn(),
      initialize: jest.fn().mockReturnValue(false),
      start: jest.fn(),
      stop: jest.fn(),
      onEnded: null,
    } as any);

    const streamer1 = lastStreamer();
    streamer1.simulateEnded();
    await flushAsync();

    // BUG #9: on unfixed code errors.length === 0
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Bug #10 — seekTo with null createStreamer  [EXPECTED TO FAIL on unfixed code]
// ===========================================================================

describe('Bug #10: seekTo with null createStreamer', () => {
  /**
   * createStreamer() can return null if the AudioContext is suspended or the
   * native module is unavailable. seekTo() does not guard against this and
   * leaves the engine in State.Playing with no audio source.
   *
   * Fix: check the return value of createStreamer() and transition to
   * State.Error if it is null.
   */

  // BUG #10 — EXPECTED TO FAIL on unfixed code
  it('[BUG #10] seekTo with null createStreamer does not leave engine Playing with no source', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1, 120)]);
    await TrackPlayer.play();

    const ctx = getLastAudioContext()!;
    clearCreatedStreamers();

    jest.spyOn(ctx, 'createStreamer').mockReturnValueOnce(null);
    await TrackPlayer.seekTo(30);

    const streamersAfterSeek = getCreatedStreamers();
    const { state } = await TrackPlayer.getPlaybackState();

    // BUG #10: on unfixed code state === State.Playing && streamersAfterSeek.length === 0
    const ghostPlayingState = state === State.Playing && streamersAfterSeek.length === 0;
    expect(ghostPlayingState).toBe(false);
  });

  it('valid seekTo does not break subsequent auto-advance', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1, 120), track(2)]);
    await TrackPlayer.play();

    clearCreatedStreamers();
    await TrackPlayer.seekTo(60);

    const seekStreamer = lastStreamer();
    clearCreatedStreamers();
    seekStreamer.simulateEnded();
    await flushAsync();

    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
  });
});

// ===========================================================================
// Bug #11 — End-of-queue cleanup  [EXPECTED TO FAIL on unfixed code]
// ===========================================================================

describe('Bug #11: end-of-queue cleanup', () => {
  /**
   * When the last track completes naturally, the engine should:
   *   1. Emit PlaybackActiveTrackChanged with track: null
   *   2. Transition to State.Stopped
   *
   * Neither currently happens. The UI gets stuck showing the last track as
   * active, and the state stays at State.Ended (not a documented public state).
   *
   * Fix: in the onEnded handler, after detecting queue exhaustion, emit
   * PlaybackActiveTrackChanged({ track: null, index: -1 }) and call stop().
   */

  // BUG #11 — EXPECTED TO FAIL on unfixed code
  it('[BUG #11] emits PlaybackActiveTrackChanged(null) when the last track finishes', async () => {
    await setup();

    let receivedNullTrackEvent = false;
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e: any) => {
      if (e.track === null) receivedNullTrackEvent = true;
    });

    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();

    lastStreamer().simulateEnded();
    await flushAsync();

    // BUG #11: on unfixed code receivedNullTrackEvent === false
    expect(receivedNullTrackEvent).toBe(true);
  });

  // BUG #11 — EXPECTED TO FAIL on unfixed code
  it('[BUG #11] state transitions to Stopped (not Ended) after the queue completes', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();

    lastStreamer().simulateEnded();
    await flushAsync();

    const { state } = await TrackPlayer.getPlaybackState();

    // BUG #11: on unfixed code state === State.Ended
    expect(state).toBe(State.Stopped);
  });
});
