import { Track, State, Event, Capability, PlaybackState, UpdateOptions } from './types';
import { QueueManager } from './QueueManager';
import { PlaybackEngine } from './PlaybackEngine';
import { NotificationBridge } from './NotificationBridge';
import { emitter } from './EventEmitter';
import { _registerProgressGetters } from './hooks/useProgress';

// ---------------------------------------------------------------------------
// Module-level singletons
// All state lives here so TrackPlayer can be used as a static API (matching RNTP).
// ---------------------------------------------------------------------------

const queue = new QueueManager();
const engine = new PlaybackEngine();
const bridge = new NotificationBridge();

// Wire auto-advance: when a track ends naturally, move to the next one.
engine.onTrackEnded(async () => {
  const lastTrack = queue.getActiveTrack() ?? null;
  const lastIndex = queue.getActiveIndex();
  const advanced = queue.skipToNext();

  if (advanced) {
    const next = queue.getActiveTrack()!;
    const nextIndex = queue.getActiveIndex();

    await engine.loadAndPlay(next);
    await bridge.updateNowPlaying(next, State.Playing, 0);

    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: next,
      index: nextIndex,
      lastTrack,
      lastIndex,
    });

    // Kick off prefetch for the track after this one
    const upcoming = queue.getTrack(nextIndex + 1);
    if (upcoming) {
      engine.prefetchNext(upcoming).catch(() => { /* non-fatal */ });
    }
  } else {
    // Reached end of queue
    await bridge.hide();
  }
});

// ---------------------------------------------------------------------------
// TrackPlayer public API
// ---------------------------------------------------------------------------

const TrackPlayer = {

  // --------------------------------------------------------------------------
  // Setup
  // --------------------------------------------------------------------------

  /**
   * Initialize the audio engine and register progress getters for useProgress().
   * Must be called before any other TrackPlayer method — equivalent to RNTP's
   * setupPlayer().
   */
  async setupPlayer(): Promise<void> {
    engine.init();

    // Wire engine getters into the useProgress hook without creating circular imports
    _registerProgressGetters(
      () => engine.getPosition(),
      () => engine.getDuration()
    );
  },

  /**
   * Configure playback capabilities (controls shown in the system notification).
   * Equivalent to RNTP's updateOptions().
   */
  async updateOptions(options: UpdateOptions): Promise<void> {
    const caps = options.capabilities ?? options.notificationCapabilities ?? [];
    await bridge.setup(caps);
  },

  // --------------------------------------------------------------------------
  // Event system
  // --------------------------------------------------------------------------

  /**
   * Register a listener for a TrackPlayer event.
   * Returns a subscription object with a `.remove()` method — identical to RNTP.
   */
  addEventListener(
    event: Event,
    handler: (...args: unknown[]) => void
  ): { remove: () => void } {
    const unsub = emitter.on(event, handler);
    return { remove: unsub };
  },

  // --------------------------------------------------------------------------
  // Queue management
  // --------------------------------------------------------------------------

  /**
   * Replace the current queue and begin playback from the first track.
   */
  async setQueue(tracks: Track[]): Promise<void> {
    // Stop anything currently playing before replacing the queue
    await engine.stop();
    queue.setQueue(tracks);

    const first = queue.getActiveTrack();
    if (!first) return;

    await engine.loadAndPlay(first);
    await bridge.updateNowPlaying(first, State.Playing, 0);

    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: first,
      index: 0,
      lastTrack: null,
      lastIndex: -1,
    });

    // Prefetch second track in the background
    const second = queue.getTrack(1);
    if (second) {
      engine.prefetchNext(second).catch(() => { /* non-fatal */ });
    }
  },

  /** Append tracks to the end of the queue. */
  async add(tracks: Track[]): Promise<void> {
    queue.add(tracks);
  },

  /**
   * Remove tracks by index or Track object (single or array).
   * Matches RNTP's remove() signature — also accepts Track objects for
   * convenience (resolved to indices by URL).
   */
  async remove(indexOrIndices: number | number[] | Track | Track[]): Promise<void> {
    queue.remove(indexOrIndices);
  },

  async getQueue(): Promise<Track[]> {
    return queue.getQueue();
  },

  async getTrack(index: number): Promise<Track | undefined> {
    return queue.getTrack(index);
  },

  async getActiveTrack(): Promise<Track | undefined> {
    return queue.getActiveTrack();
  },

  async getActiveTrackIndex(): Promise<number> {
    return queue.getActiveIndex();
  },

  // --------------------------------------------------------------------------
  // Playback control
  // --------------------------------------------------------------------------

  async play(): Promise<void> {
    const state = engine.getState();

    if (state === State.Paused) {
      await engine.resume();
      const track = queue.getActiveTrack();
      if (track) {
        await bridge.updateNowPlaying(track, State.Playing, engine.getPosition());
      }
      return;
    }

    if (state === State.Stopped || state === State.None || state === State.Ended) {
      // Re-play the active track from the beginning (matches RNTP behaviour)
      const track = queue.getActiveTrack();
      if (track) {
        await engine.loadAndPlay(track);
        await bridge.updateNowPlaying(track, State.Playing, 0);
      }
    }
    // Already Playing → no-op
  },

  async pause(): Promise<void> {
    await engine.pause();
    const track = queue.getActiveTrack();
    if (track) {
      await bridge.updateNowPlaying(track, State.Paused, engine.getPosition());
    }
  },

  async stop(): Promise<void> {
    await engine.stop();
    await bridge.hide();
  },

  /**
   * Stop playback and clear the queue entirely.
   */
  async reset(): Promise<void> {
    await engine.stop();
    queue.reset();
    await bridge.hide();
  },

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------

  async skipToNext(): Promise<void> {
    const lastTrack = queue.getActiveTrack() ?? null;
    const lastIndex = queue.getActiveIndex();
    const advanced = queue.skipToNext();

    if (!advanced) return;

    const track = queue.getActiveTrack()!;
    const index = queue.getActiveIndex();

    await engine.loadAndPlay(track);
    await bridge.updateNowPlaying(track, State.Playing, 0);

    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track,
      index,
      lastTrack,
      lastIndex,
    });

    const upcoming = queue.getTrack(index + 1);
    if (upcoming) {
      engine.prefetchNext(upcoming).catch(() => { /* non-fatal */ });
    }
  },

  /**
   * If more than 3 seconds into the current track, seek back to the start.
   * Otherwise, go to the previous track. Matches RNTP's skipToPrevious() behaviour.
   */
  async skipToPrevious(): Promise<void> {
    const position = engine.getPosition();

    if (position > 3) {
      await engine.seekTo(0);
      const track = queue.getActiveTrack();
      if (track) {
        await bridge.updateNowPlaying(track, engine.getState(), 0);
      }
      return;
    }

    const lastTrack = queue.getActiveTrack() ?? null;
    const lastIndex = queue.getActiveIndex();
    const went = queue.skipToPrevious();

    if (!went) {
      // Already at start — restart the current track instead
      await engine.seekTo(0);
      return;
    }

    const track = queue.getActiveTrack()!;
    const index = queue.getActiveIndex();

    await engine.loadAndPlay(track);
    await bridge.updateNowPlaying(track, State.Playing, 0);

    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track,
      index,
      lastTrack,
      lastIndex,
    });
  },

  async seekTo(seconds: number): Promise<void> {
    await engine.seekTo(seconds);
    const track = queue.getActiveTrack();
    if (track) {
      await bridge.updateNowPlaying(track, engine.getState(), seconds);
    }
  },

  // --------------------------------------------------------------------------
  // State queries
  // --------------------------------------------------------------------------

  /**
   * Modern RNTP API — returns { state: State }.
   */
  async getPlaybackState(): Promise<PlaybackState> {
    return { state: engine.getState() };
  },

  /**
   * Legacy RNTP API — returns State directly.
   * Kept for full drop-in compatibility.
   */
  async getState(): Promise<State> {
    return engine.getState();
  },

  async getPosition(): Promise<number> {
    return engine.getPosition();
  },

  async getDuration(): Promise<number> {
    return engine.getDuration();
  },

  async getProgress(): Promise<{ position: number; duration: number; buffered: number }> {
    const duration = engine.getDuration();
    return {
      position: engine.getPosition(),
      duration,
      buffered: duration,
    };
  },
};

export default TrackPlayer;

// ---------------------------------------------------------------------------
// registerPlaybackService — no-op for drop-in compatibility
// ---------------------------------------------------------------------------

/**
 * In RNTP, this registers a background service function that handles remote
 * events. In react-native-track-playback, remote events are handled directly
 * via PlaybackNotificationManager, so no background service is needed.
 *
 * This function exists purely so that callers don't have to remove it during
 * migration. The passed factory is never invoked.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerPlaybackService(_factory: () => Promise<void>): void {
  // intentional no-op
}
