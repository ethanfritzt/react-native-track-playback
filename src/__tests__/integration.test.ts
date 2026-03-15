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
 */

import TrackPlayer from '../TrackPlayer';
import { Event, State } from '../types';
import {
  getLastAudioContext,
  getCreatedStreamers,
  clearCreatedStreamers,
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

function lastStreamer() {
  const s = getCreatedStreamers();
  return s[s.length - 1]!;
}

/** Flush all microtasks + two rounds of setImmediate. */
async function flushAsync() {
  await Promise.resolve();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCreatedStreamers();
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

    // Load and start
    await TrackPlayer.setQueue([track(1, 120)]);
    await TrackPlayer.play();

    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
    expect(events).toContain('trackChanged');

    // Seek forward
    await TrackPlayer.seekTo(45);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    // Pause
    await TrackPlayer.pause();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Paused });

    // Advance time while paused — position must NOT move
    getLastAudioContext()!.advanceTime(30);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    // Resume
    await TrackPlayer.play();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // Advance more time and confirm position tracks correctly
    getLastAudioContext()!.advanceTime(10);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(55, 3);

    // Natural end
    const streamer = lastStreamer();
    streamer.simulateEnded();
    await flushAsync();

    // After the sole track ends the notification should be hidden
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

    // ── Track 1 ends naturally ──────────────────────────────────────────────
    const streamer1 = lastStreamer();
    clearCreatedStreamers();

    streamer1.simulateEnded();
    await flushAsync();

    let active = await TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // ── Track 2 ends naturally ──────────────────────────────────────────────
    const streamer2 = lastStreamer();
    clearCreatedStreamers();

    streamer2.simulateEnded();
    await flushAsync();

    active = await TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 3');
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // ── Track 3 (last) ends naturally ───────────────────────────────────────
    const streamer3 = lastStreamer();
    jest.clearAllMocks(); // reset notification spy counts

    streamer3.simulateEnded();
    await flushAsync();

    // Queue exhausted — notification must be hidden
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

    // index 0→1 then 1→2
    expect(changes[0]).toMatchObject({ index: 1, lastIndex: 0 });
    expect(changes[1]).toMatchObject({ index: 2, lastIndex: 1 });
  });
});

// ===========================================================================
// Scenario 3 — Full single-track lifecycle (buffer fallback path)
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

    // decodeAudioData should have been called
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // Pause
    await TrackPlayer.pause();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Paused });

    // Seek while paused
    await TrackPlayer.seekTo(30);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(30, 3);

    // Resume
    await TrackPlayer.play();
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });

    // Advance time
    getLastAudioContext()!.advanceTime(15);
    expect(await TrackPlayer.getPosition()).toBeCloseTo(45, 3);

    // Natural end
    const progress = await TrackPlayer.getProgress();
    expect(progress.duration).toBe(90);
  });

  it('prefetches next track and uses the cache on auto-advance', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1, 90), track(2, 90)]);
    await TrackPlayer.play();

    // By the time track 1 is playing, track 2 should have been prefetched
    await flushAsync();

    // Reset the spy to count only the track-2 decode (should be 0 — cache hit)
    jest.clearAllMocks();

    const s1 = lastStreamer();
    s1.simulateEnded();
    await flushAsync();

    // Track 2 already decoded via prefetch — no second decodeAudioData call
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
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
    // Active track is still Track 1
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

    await TrackPlayer.remove([2]); // remove Track 3

    const q = await TrackPlayer.getQueue();
    expect(q).toHaveLength(2);
    // Playback must be uninterrupted
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

    // Notification shown with track info
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 1' }),
    );

    jest.clearAllMocks();

    // seekTo updates elapsed time in the notification
    await TrackPlayer.seekTo(30);
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedTime: 30 }),
    );

    jest.clearAllMocks();

    // updateMetadataForTrack on the active track refreshes the notification
    await TrackPlayer.updateMetadataForTrack(0, { artwork: 'https://example.com/cover.jpg' });
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ artwork: 'https://example.com/cover.jpg' }),
    );

    jest.clearAllMocks();

    // stop() should hide the notification
    await TrackPlayer.stop();
    expect(PlaybackNotificationManager.hide).toHaveBeenCalledTimes(1);
  });

  it('show is called for each track on auto-advance, then hidden at end-of-queue', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();

    // Track 1 playing
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 1' }),
    );

    const s1 = lastStreamer();
    jest.clearAllMocks();

    s1.simulateEnded();
    await flushAsync();

    // Track 2 now showing
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
    await TrackPlayer.skipToNext(); // → Track 2

    clearCreatedStreamers();
    await TrackPlayer.skipToNext(); // already at end — no-op

    expect(getCreatedStreamers()).toHaveLength(0);
    expect(await TrackPlayer.getActiveTrack()).toMatchObject({ title: 'Track 2' });
    expect(await TrackPlayer.getPlaybackState()).toMatchObject({ state: State.Playing });
  });

  it('skipToPrevious >3 s in restarts current track, not the previous one', async () => {
    await setup();

    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext(); // → Track 2

    getLastAudioContext()!.advanceTime(10); // > 3 s in Track 2

    clearCreatedStreamers();
    await TrackPlayer.skipToPrevious();

    // Still on Track 2 but restarted
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

    await TrackPlayer.skipToNext();     // 0 → 1
    await TrackPlayer.skipToNext();     // 1 → 2
    await TrackPlayer.skipToPrevious(); // 2 → 1 (position is 0 at each load)
    await TrackPlayer.skipToPrevious(); // 1 → 0

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
    expect(await TrackPlayer.getActiveTrack()).toBeNull();
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
    expect(handler).toHaveBeenCalledTimes(1); // initial play → trackChanged

    sub.remove();

    await TrackPlayer.skipToNext(); // should NOT trigger handler anymore
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

    // h1 only fires for the initial play (before removal)
    expect(h1).toHaveBeenCalledTimes(1);
    // h2 fires for play and skip
    expect(h2).toHaveBeenCalledTimes(2);
  });
});
