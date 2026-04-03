/**
 * TrackPlayer integration tests.
 *
 * These tests exercise the full TrackPlayer public API — queue management,
 * playback control, navigation, and event emission — using the mocked
 * react-native-audio-api. The native audio layer is replaced entirely; we
 * verify that TrackPlayer correctly orchestrates PlaybackEngine, QueueManager,
 * NotificationBridge, and the EventEmitter.
 *
 * resetModules: true in jest.config ensures the TrackPlayer singleton and all
 * its collaborators are fresh for each test.
 */

import TrackPlayer from '../TrackPlayer';
import { Event, State } from '../types';
import {
  getLastAudioContext,
  getCreatedStreamers,
  clearCreatedStreamers,
  setStreamerAvailable,
  PlaybackNotificationManager,
} from '../__mocks__/react-native-audio-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function track(n: number, duration = 30) {
  return {
    url: `http://example.com/track${n}.mp3`,
    title: `Track ${n}`,
    artist: 'Artist',
    album: 'Album',
    duration,
  };
}

async function setup() {
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [],
  });
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  clearCreatedStreamers();
  setStreamerAvailable(true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// setupPlayer / updateOptions
// ---------------------------------------------------------------------------

describe('setupPlayer', () => {
  it('initialises without throwing', async () => {
    await expect(TrackPlayer.setupPlayer()).resolves.toBeUndefined();
  });
});

describe('updateOptions', () => {
  it('calls PlaybackNotificationManager.enableControl for each known control', async () => {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({ capabilities: [] });
    // 7 controls total (play, pause, next, previous, skipForward, skipBackward, seekTo)
    expect(PlaybackNotificationManager.enableControl).toHaveBeenCalledTimes(7);
  });
});

// ---------------------------------------------------------------------------
// setQueue
// ---------------------------------------------------------------------------

describe('setQueue', () => {
  it('does NOT begin playback — state is Stopped after setQueue alone', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Stopped);
  });

  it('begins playing after setQueue + play()', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('emits PlaybackActiveTrackChanged with the first track after setQueue + play()', async () => {
    await setup();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.setQueue([track(1), track(2)]);
    expect(handler).not.toHaveBeenCalled(); // setQueue alone should not emit
    await TrackPlayer.play();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ track: expect.objectContaining({ title: 'Track 1' }), index: 0, lastTrack: null, lastIndex: -1 })
    );
  });

  it('sets the active track to the first item', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    const active = TrackPlayer.getActiveTrack();
    expect(active?.url).toBe('http://example.com/track1.mp3');
  });

  it('does NOT emit PlaybackActiveTrackChanged', async () => {
    await setup();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.setQueue([track(1), track(2)]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('calls PlaybackNotificationManager.show only after play()', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    expect(PlaybackNotificationManager.show).not.toHaveBeenCalled();
    await TrackPlayer.play();
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Track 1' })
    );
  });

  it('returns an empty queue for an empty array without throwing', async () => {
    await setup();
    await expect(TrackPlayer.setQueue([])).resolves.toBeUndefined();
    const q = TrackPlayer.getQueue();
    expect(q).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// add / remove / getQueue / getTrack
// ---------------------------------------------------------------------------

describe('add / remove / getQueue / getTrack', () => {
  it('add appends tracks to the queue', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    TrackPlayer.add([track(2), track(3)]);
    const q = TrackPlayer.getQueue();
    expect(q).toHaveLength(3);
  });

  it('remove removes a track by index', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    TrackPlayer.remove([1]);
    const q = TrackPlayer.getQueue();
    expect(q).toHaveLength(2);
    expect(q[1]?.title).toBe('Track 3');
  });

  it('getTrack returns the track at the given index', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    const t = TrackPlayer.getTrack(1);
    expect(t?.title).toBe('Track 2');
  });
});


// ---------------------------------------------------------------------------
// play / pause
// ---------------------------------------------------------------------------

describe('play / pause', () => {
  it('play after setQueue starts playback', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('pause transitions to Paused state', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.pause();
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Paused);
  });

  it('play after pause resumes', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.pause();
    await TrackPlayer.play();
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('play after stop reloads the active track', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.stop();
    clearCreatedStreamers();
    await TrackPlayer.play();
    expect(getCreatedStreamers()).toHaveLength(1);
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('play while already Playing is a no-op', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    clearCreatedStreamers();
    await TrackPlayer.play(); // already playing
    // No new streamer created
    expect(getCreatedStreamers()).toHaveLength(0);
  });

  it('play while already Playing does NOT re-emit PlaybackActiveTrackChanged', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.play(); // already playing — no-op
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stop / reset
// ---------------------------------------------------------------------------

describe('stop / reset', () => {
  it('stop transitions to Stopped and hides notification', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.stop();
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Stopped);
    expect(PlaybackNotificationManager.hide).toHaveBeenCalled();
  });

  it('stop emits PlaybackActiveTrackChanged with track: null', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.stop();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ track: null, index: -1, lastTrack: expect.objectContaining({ title: 'Track 1' }) })
    );
  });

  it('reset clears the queue', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.reset();
    const q = TrackPlayer.getQueue();
    expect(q).toHaveLength(0);
  });

  it('reset emits PlaybackActiveTrackChanged with track: null', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.reset();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ track: null, index: -1, lastTrack: expect.objectContaining({ title: 'Track 1' }) })
    );
  });
});

// ---------------------------------------------------------------------------
// skipToNext / skipToPrevious
// ---------------------------------------------------------------------------

describe('skipToNext', () => {
  it('advances to the next track and begins playing it', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext();
    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('emits PlaybackActiveTrackChanged with the correct indices', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    await TrackPlayer.skipToNext();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, lastIndex: 0 })
    );
  });

  it('is a no-op at the end of the queue', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    clearCreatedStreamers();
    await TrackPlayer.skipToNext();
    expect(getCreatedStreamers()).toHaveLength(0);
    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 1');
  });
});

describe('skipToPrevious', () => {
  it('goes to the previous track when less than 3 seconds in', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext(); // now on Track 2
    await TrackPlayer.skipToPrevious();
    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 1');
  });

  it('restarts the current track when more than 3 seconds in', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext(); // on Track 2
    // Advance context time > 3 seconds
    getLastAudioContext()!.advanceTime(5);
    clearCreatedStreamers();
    await TrackPlayer.skipToPrevious();
    // Should not have loaded a new track — just seeked to 0
    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
  });

  it('at the start of queue, restarts the current track', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    // position is 0, at first track — skipToPrevious should restart
    clearCreatedStreamers();
    await TrackPlayer.skipToPrevious();
    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 1');
  });
});

// ---------------------------------------------------------------------------
// seekTo / getPosition / getProgress
// ---------------------------------------------------------------------------

describe('seekTo / getPosition / getProgress', () => {
  it('seekTo updates position and updates the notification', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1, 120)]);
    await TrackPlayer.play();
    await TrackPlayer.seekTo(45);
    const pos = TrackPlayer.getPosition();
    expect(pos).toBeCloseTo(45, 4);
    expect(PlaybackNotificationManager.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ elapsedTime: 45 })
    );
  });

  it('getProgress returns position and duration', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1, 180)]);
    await TrackPlayer.play();
    const prog = TrackPlayer.getProgress();
    expect(prog.duration).toBe(180);
    expect(prog.position).toBeCloseTo(0, 4);
  });
});

// ---------------------------------------------------------------------------
// Auto-advance (natural track end)
// ---------------------------------------------------------------------------

describe('auto-advance on track end', () => {
  it('loads and plays the next track when the streamer ends naturally', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    clearCreatedStreamers();

    getLastAudioContext()!.advanceTime(31);
    jest.advanceTimersByTime(250);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
  });

  it('hides the notification when the last track ends', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    jest.clearAllMocks();

    getLastAudioContext()!.advanceTime(31);
    jest.advanceTimersByTime(250);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(PlaybackNotificationManager.hide).toHaveBeenCalled();
  });

  it('emits PlaybackActiveTrackChanged on auto-advance', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();

    const handler = jest.fn();
    TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);

    getLastAudioContext()!.advanceTime(31);
    jest.advanceTimersByTime(250);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const active = TrackPlayer.getActiveTrack();
    expect(active?.title).toBe('Track 2');
    const { state } = TrackPlayer.getPlaybackState();
    expect(state).toBe(State.Playing);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1 })
    );
  });
});

// ---------------------------------------------------------------------------
// addEventListener / removeEventListener
// ---------------------------------------------------------------------------

describe('addEventListener', () => {
  it('returns a subscription with a remove() method', async () => {
    await setup();
    const sub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, jest.fn());
    expect(typeof sub.remove).toBe('function');
  });

  it('removed subscription no longer receives events', async () => {
    await setup();
    const handler = jest.fn();
    const sub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, handler);
    sub.remove();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play(); // play() triggers PlaybackActiveTrackChanged
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateMetadataForTrack
// ---------------------------------------------------------------------------

describe('updateMetadataForTrack', () => {
  it('patches the stored track in the queue', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.updateMetadataForTrack(1, { title: 'Patched' });
    const t = TrackPlayer.getTrack(1);
    expect(t?.title).toBe('Patched');
  });

  it('updates the notification when patching the active track', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    jest.clearAllMocks();
    await TrackPlayer.updateMetadataForTrack(0, { artwork: 'https://example.com/art.jpg' });
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({ artwork: 'https://example.com/art.jpg' })
    );
  });

  it('does NOT update the notification when patching a non-active track', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    await TrackPlayer.play();
    jest.clearAllMocks();
    await TrackPlayer.updateMetadataForTrack(1, { title: 'Patched' });
    expect(PlaybackNotificationManager.show).not.toHaveBeenCalled();
  });

  it('is a no-op for an out-of-bounds index', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await expect(TrackPlayer.updateMetadataForTrack(99, { title: 'x' })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateNowPlayingMetadata
// ---------------------------------------------------------------------------

describe('updateNowPlayingMetadata', () => {
  it('updates the notification with merged metadata', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    jest.clearAllMocks();
    await TrackPlayer.updateNowPlayingMetadata({ artwork: 'https://example.com/art.jpg' });
    expect(PlaybackNotificationManager.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Track 1',
        artwork: 'https://example.com/art.jpg',
      })
    );
  });

  it('does not mutate the stored track in the queue', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1)]);
    await TrackPlayer.play();
    await TrackPlayer.updateNowPlayingMetadata({ title: 'Override' });
    const stored = TrackPlayer.getActiveTrack();
    expect(stored?.title).toBe('Track 1'); // original unchanged
  });

  it('is a no-op when the queue is empty', async () => {
    await setup();
    await TrackPlayer.reset();
    jest.clearAllMocks();
    await expect(TrackPlayer.updateNowPlayingMetadata({ title: 'x' })).resolves.toBeUndefined();
    expect(PlaybackNotificationManager.show).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getActiveTrackIndex
// ---------------------------------------------------------------------------

describe('getActiveTrackIndex', () => {
  it('returns 0 for the first track', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2)]);
    expect(TrackPlayer.getActiveTrackIndex()).toBe(0);
  });

  it('updates after skipToNext', async () => {
    await setup();
    await TrackPlayer.setQueue([track(1), track(2), track(3)]);
    await TrackPlayer.play();
    await TrackPlayer.skipToNext();
    expect(TrackPlayer.getActiveTrackIndex()).toBe(1);
  });
});
