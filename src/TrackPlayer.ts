import { Track, TrackMetadata, State, Event, PlaybackState, Progress, UpdateOptions, PlaybackError, EventPayloadMap, Subscription } from './types';
import { QueueManager } from './QueueManager';
import { PlaybackEngine } from './PlaybackEngine';
import { NotificationBridge } from './NotificationBridge';
import { emitter } from './EventEmitter';
import { _registerProgressGetters } from './hooks/useProgress';

// ---------------------------------------------------------------------------
// Module-level singletons
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

    // Audio-start is the critical path — await it alone so the user hears
    // audio as soon as possible. Notification update is metadata-only and
    // does not affect playback correctness, so fire it without blocking.
    try {
      await engine.loadAndPlay(next);
    } catch (err: unknown) {
      emitter.emit(Event.PlaybackError, new PlaybackError(
        err instanceof Error ? err.message : String(err),
        -1,
      ));
      return;
    }
    bridge.updateNowPlaying(next, State.Playing, 0).catch(console.error);

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
    // Reached end of queue — reset engine to Stopped and notify listeners so
    // useProgress stops polling and active-track consumers see null.
    await engine.stop();
    await bridge.hide();
    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: null,
      index: -1,
      lastTrack,
      lastIndex,
    });
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
   * Initialize the audio engine.
   *
   * @deprecated The player now auto-initializes on first use (#53). Calling
   * this method is no longer required and will be removed in a future major
   * version. You can safely remove all `setupPlayer()` calls from your app.
   *
   * This method is idempotent — calling it multiple times has no effect beyond
   * the first call.
   */
  async setupPlayer(): Promise<void> {
    // engine.init() is idempotent: if (this.context) return;
    engine.init();

    // Wire engine getters into the useProgress hook without creating circular imports
    _registerProgressGetters(
      () => engine.getPosition(),
      () => engine.getDuration(),
      () => engine.getState(),
    );
  },

  /**
   * Tear down the player completely — stops playback, clears the queue, destroys
   * the native AudioContext, and removes notification subscriptions.
   *
   * Call this when you need to fully reset the player (e.g. during hot reload
   * cleanup in development, or when the player is no longer needed).
   *
   * After calling destroy(), the player will auto-initialize on the next method
   * call. You do not need to call setupPlayer() again.
   */
  async destroy(): Promise<void> {
    await engine.destroy();
    bridge.teardown();
    queue.reset();
  },

  /**
   * Configure playback capabilities (controls shown in the system notification).
   */
  async updateOptions(options: UpdateOptions): Promise<void> {
    const caps = options.capabilities ?? [];
    await bridge.setup(caps);
  },

  // --------------------------------------------------------------------------
  // Event system
  // --------------------------------------------------------------------------

  /**
   * Register a typed listener for a TrackPlayer event.
   * The handler receives the correct payload type for the given event.
   * Returns a subscription object with a `.remove()` method.
   */
  addEventListener<E extends keyof EventPayloadMap>(
    event: E,
    handler: (payload: EventPayloadMap[E]) => void
  ): Subscription {
    const unsub = emitter.on(event, handler as (...args: unknown[]) => void);
    return { remove: unsub };
  },

  // --------------------------------------------------------------------------
  // Queue management
  // --------------------------------------------------------------------------

  /**
   * Replace the current queue without starting playback. The caller must
   * explicitly invoke play() to begin audio.
   *
   * Always stops the engine before replacing the queue. This handles all states:
   * - Playing / Paused: tears down the active source node
   * - Loading / Buffering: increments loadGeneration to cancel the in-flight load
   * - Stopped / Ended / None: no-op on audio state, just resets cleanly
   */
  async setQueue(tracks: Track[]): Promise<void> {
    await engine.stop();
    queue.setQueue(tracks);
  },

  /** Append tracks to the end of the queue. */
  async add(tracks: Track[]): Promise<void> {
    queue.add(tracks);
  },

  /**
   * Remove tracks by index or Track object (single or array).
   * Also accepts Track objects for convenience (resolved to indices by URL).
   */
  async remove(indexOrIndices: number | number[] | Track | Track[]): Promise<void> {
    queue.remove(indexOrIndices);
  },

  async getQueue(): Promise<readonly Track[]> {
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

  /**
   * Patch metadata fields on a queued track in-place.
   * If the patched track is the currently active track, the system notification
   * and lock screen are updated immediately.
   *
   * `url` cannot be changed here — use setQueue() or add() for that.
   */
  async updateMetadataForTrack(index: number, metadata: TrackMetadata): Promise<void> {
    const updated = queue.updateTrack(index, metadata);
    if (!updated) return;

    // Only refresh the notification if this is the active track
    if (index === queue.getActiveIndex()) {
      const track = queue.getActiveTrack()!;
      await bridge.updateNowPlaying(track, engine.getState(), engine.getPosition());
    }
  },

  /**
   * Update the system notification / lock screen display only — does not
   * mutate the track stored in the queue. Fields are merged with the active
   * track's existing data, so only the fields you pass are overridden.
   *
   * Use this for ephemeral display updates (e.g. artwork arriving late, live
   * stream title changes) without permanently altering the queued track data.
   */
  async updateNowPlayingMetadata(metadata: TrackMetadata): Promise<void> {
    const track = queue.getActiveTrack();
    if (!track) return;

    // Merge metadata over the active track without mutating the queue
    const merged: Track = { ...track, ...metadata };
    await bridge.updateNowPlaying(merged, engine.getState(), engine.getPosition());
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

    if (state === State.Playing) {
      // Already playing — no-op
      return;
    }

    // For all other states (Stopped, None, Ended, Error, Loading, Buffering, Ready):
    // cancel any in-flight load and start the active track from the beginning.
    // Loading/Buffering/Ready can occur if setQueue() was called while a previous
    // load was in-flight — engine.loadAndPlay() increments loadGeneration, which
    // cancels the stale load before starting fresh.
    const track = queue.getActiveTrack();
    if (track) {
      const index = queue.getActiveIndex();
      await engine.loadAndPlay(track);
      bridge.updateNowPlaying(track, State.Playing, 0).catch(console.error);
      emitter.emit(Event.PlaybackActiveTrackChanged, {
        track,
        index,
        lastTrack: null,
        lastIndex: -1,
      });
    }
  },

  async pause(): Promise<void> {
    await engine.pause();
    const track = queue.getActiveTrack();
    if (track) {
      await bridge.updateNowPlaying(track, State.Paused, engine.getPosition());
    }
  },

  async stop(): Promise<void> {
    const lastTrack = queue.getActiveTrack() ?? null;
    const lastIndex = queue.getActiveIndex();
    await engine.stop();
    await bridge.hide();
    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: null,
      index: -1,
      lastTrack,
      lastIndex,
    });
  },

  /**
   * Stop playback and clear the queue entirely.
   */
  async reset(): Promise<void> {
    const lastTrack = queue.getActiveTrack() ?? null;
    const lastIndex = queue.getActiveIndex();
    await engine.stop();
    queue.reset();
    await bridge.hide();
    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: null,
      index: -1,
      lastTrack,
      lastIndex,
    });
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
    bridge.updateNowPlaying(track, State.Playing, 0).catch(console.error);

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
   * Otherwise, go to the previous track.
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
    bridge.updateNowPlaying(track, State.Playing, 0).catch(console.error);

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

  async getPlaybackState(): Promise<PlaybackState> {
    return { state: engine.getState() };
  },

  async getState(): Promise<State> {
    return engine.getState();
  },

  async getPosition(): Promise<number> {
    return engine.getPosition();
  },

  async getDuration(): Promise<number> {
    return engine.getDuration();
  },

  async getProgress(): Promise<Progress> {
    return {
      position: engine.getPosition(),
      duration: engine.getDuration(),
    };
  },
};

export default TrackPlayer;
