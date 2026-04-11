import {
  AudioContext,
  type GainNode,
  type StreamerNode,
} from 'react-native-audio-api';
import { Event, State, Track, PlaybackError } from './types';
import { emitter } from './EventEmitter';

/**
 * PlaybackEngine owns the AudioContext and source node lifecycle.
 *
 * ## Playback strategy
 *
 * The engine uses StreamerNode exclusively (true HTTP streaming via FFmpeg).
 * Calls context.createStreamer(), then streamer.initialize(url) and streamer.start().
 * Audio begins playing within ~1-2 seconds because the native layer starts decoding
 * the stream progressively — no full-file download required before the first sample plays.
 *
 * StreamerNode requires the react-native-audio-api plugin to be built with FFmpeg
 * (disableFFmpeg: false, which is the default and is explicitly forwarded by the
 * react-native-track-playback Expo plugin).
 *
 * ## Position tracking
 *
 *   context.currentTime stops incrementing when the context is suspended
 *   (per the RNAP docs). We therefore track position manually:
 *
 *   - playStartContextTime: context.currentTime value when source.start() was called
 *   - playStartOffset:      seek offset (seconds into the track) passed to start()
 *   - pausedPosition:       snapshot of position taken at the moment of suspension
 *
 *   While playing:  position = context.currentTime - playStartContextTime + playStartOffset
 *   While paused:   position = pausedPosition  (context.currentTime has stopped)
 *   Otherwise:      position = 0
 *
 * ## Concurrency
 *
 *   loadAndPlay() is not re-entrant. Each call increments `loadGeneration`. The
 *   private load helpers check the generation at every async yield point and bail
 *   out silently if a newer load has superseded them. This ensures that rapid
 *   track-changes (shuffle, quick skips) never leave a stale streamer running or
 *   corrupt the engine state.
 */
export class PlaybackEngine {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  // --- StreamerNode path ---
  private streamerNode: StreamerNode | null = null;
  /** URL of the track currently loaded into the streamer (needed for seekTo). */
  private currentTrackUrl: string | null = null;
  /** Duration from track metadata — used instead of buffer.duration when streaming. */
  private currentTrackDuration: number = 0;

  // Position tracking
  private playStartContextTime: number = 0;
  private playStartOffset: number = 0;
  private pausedPosition: number = 0;

  private _state: State = State.None;

  /** Called by TrackPlayer when a track ends naturally (not via stop/skip). */
  private endedCallback: (() => void) | null = null;

  /**
   * Monotonically incrementing counter. Incremented at the start of every
   * loadAndPlay() call. Each async helper captures the value at entry and
   * aborts if it no longer matches — ensuring only the latest load wins.
   */
  private loadGeneration = 0;

  /** Interval handle for the StreamerNode track-end poller. */
  private streamerPollTimer: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(): void {
    if (this.context) return; // idempotent
    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  async destroy(): Promise<void> {
    // Invalidate any in-flight load so its async continuation is a no-op
    this.loadGeneration++;
    this.teardownSource();
    this.currentTrackUrl = null;
    this.currentTrackDuration = 0;
    await this.context?.close();
    this.context = null;
    this.gainNode = null;
    this.setState(State.None);
  }

  // ---------------------------------------------------------------------------
  // Core playback
  // ---------------------------------------------------------------------------

  async loadAndPlay(track: Track, startOffset = 0): Promise<void> {
    this.ensureReady();

    // Increment generation — any in-flight load from a previous call will
    // detect the mismatch at its next yield point and abort.
    const generation = ++this.loadGeneration;

    // Tear down previous source before changing state so onEnded doesn't fire
    this.teardownSource();
    this.setState(State.Loading);

    try {
      await this.loadAndPlayStreamer(track, startOffset, generation);
    } catch (err) {
      // Only update state for the load that is still current
      if (generation === this.loadGeneration) {
        this.setState(State.Error);
      }
      throw err;
    }
  }

  /**
   * StreamerNode path — starts playback almost immediately by streaming
   * the audio progressively rather than downloading the whole file first.
   */
  private async loadAndPlayStreamer(
    track: Track,
    startOffset: number,
    generation: number
  ): Promise<void> {
    const streamer = this.context!.createStreamer();
    if (!streamer) {
      throw new Error('StreamerNode unavailable: FFmpeg build required');
    }

    streamer.connect(this.gainNode!);

    // StreamerNode.initialize() takes only a URL — no offset parameter.
    // For seeking, we append a timeOffset query param to the URL (supported by
    // Subsonic's /rest/stream endpoint). For non-Subsonic URLs this is a no-op
    // on the server side but harmless as an unknown query param.
    const streamUrl =
      startOffset > 0 ? PlaybackEngine.urlWithTimeOffset(track.url, startOffset) : track.url;

    const ok = streamer.initialize(streamUrl);
    if (!ok) {
      throw new Error(`StreamerNode: failed to initialize stream for URL: ${streamUrl}`);
    }

    // Resume context if previously suspended (e.g. after a pause from a previous track)
    if (this.context!.state === 'suspended') {
      await this.context!.resume();
    }

    // A newer loadAndPlay() may have fired while we awaited context.resume().
    // If so, our streamer has already been torn down by teardownSource() in
    // the newer call — bail out without touching state.
    if (generation !== this.loadGeneration) {
      try {
        streamer.stop();
      } catch {
        /* already stopped by teardownSource */
      }
      return;
    }

    // StreamerNode.start() only accepts a `when` parameter (context time to
    // begin playing) — there is no offset parameter unlike AudioBufferSourceNode.
    // The seek offset is handled by the URL's timeOffset param above.
    streamer.start(0);

    this.playStartContextTime = this.context!.currentTime;
    this.playStartOffset = startOffset;
    this.streamerNode = streamer;
    this.currentTrackUrl = track.url;
    // Use track metadata duration — not available from the streamer itself
    this.currentTrackDuration = track.duration ?? 0;

    this.setState(State.Playing);
    this.startStreamerEndedPoller(streamer);
  }

  async pause(): Promise<void> {
    if (this._state !== State.Playing) return;
    // Snapshot position before suspending — currentTime freezes after suspend
    this.pausedPosition = this.getPosition();
    await this.context!.suspend();
    this.setState(State.Paused);
  }

  async resume(): Promise<void> {
    if (this._state !== State.Paused) return;
    await this.context!.resume();
    // Recalculate playStartContextTime so position formula stays correct after resume.
    // After resume, context.currentTime starts ticking again from where it left off.
    // We need: currentTime - playStartContextTime + playStartOffset = pausedPosition
    // => playStartContextTime = currentTime - (pausedPosition - playStartOffset)
    this.playStartContextTime =
      this.context!.currentTime - (this.pausedPosition - this.playStartOffset);
    this.setState(State.Playing);
    if (this.streamerNode) {
      this.startStreamerEndedPoller(this.streamerNode);
    }
  }

  async stop(): Promise<void> {
    // Invalidate any in-flight load
    this.loadGeneration++;
    this.teardownSource();
    this.currentTrackUrl = null;
    this.currentTrackDuration = 0;
    this.resetPositionTracking();
    // Resume context so it's ready for the next loadAndPlay call
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
    this.setState(State.Stopped);
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.currentTrackUrl) return;
    this.ensureReady();

    const wasPlaying = this._state === State.Playing;

    // If paused, resume context first so currentTime is valid when we start
    if (this._state === State.Paused) {
      await this.context!.resume();
    }

    // Streamer path: tear down and re-initialize at the new offset.
    // StreamerNode doesn't support mid-stream seeking, so we must recreate it.
    this.teardownSource();

    const streamer = this.context!.createStreamer();
    if (!streamer) {
      this.setState(State.Error);
      return;
    }

    streamer.connect(this.gainNode!);

    const seekUrl =
      seconds > 0
        ? PlaybackEngine.urlWithTimeOffset(this.currentTrackUrl, seconds)
        : this.currentTrackUrl;
    streamer.initialize(seekUrl);

    streamer.start(0);

    this.playStartContextTime = this.context!.currentTime;
    this.playStartOffset = seconds;
    this.streamerNode = streamer;
    this.startStreamerEndedPoller(streamer);

    if (wasPlaying) {
      this.setState(State.Playing);
    } else {
      // Re-suspend to stay paused at the new position
      this.pausedPosition = seconds;
      await this.context!.suspend();
      this.setState(State.Paused);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getPosition(): number {
    switch (this._state) {
      case State.Paused:
        return this.pausedPosition;
      case State.Playing:
        return this.context!.currentTime - this.playStartContextTime + this.playStartOffset;
      default:
        return 0;
    }
  }

  getDuration(): number {
    return this.currentTrackDuration;
  }

  getState(): State {
    return this._state;
  }

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  onTrackEnded(cb: () => void): void {
    this.endedCallback = cb;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Starts a 250ms interval that triggers track-ended logic when the playback
   * position reaches the track duration. This is the primary end-detection
   * mechanism for StreamerNode, whose native implementation does not fire the
   * 'ended' event through the AudioScheduledSourceNode subscription mechanism.
   */
  private startStreamerEndedPoller(streamer: StreamerNode): void {
    this.clearStreamerEndedPoller();
    if (this.currentTrackDuration <= 0) return; // unknown duration, cannot poll

    this.streamerPollTimer = setInterval(() => {
      if (this._state !== State.Playing || this.streamerNode !== streamer) {
        this.clearStreamerEndedPoller();
        return;
      }
      const epsilon = 0.1;
      if (this.getPosition() >= this.currentTrackDuration - epsilon) {
        this.clearStreamerEndedPoller();
        this.setState(State.Ended);
        this.streamerNode = null;
        Promise.resolve(this.endedCallback?.()).catch((err: Error) => {
          emitter.emit(Event.PlaybackError, new PlaybackError(err.message, -1));
        });
      }
    }, 250);
  }

  private clearStreamerEndedPoller(): void {
    if (this.streamerPollTimer !== null) {
      clearInterval(this.streamerPollTimer);
      this.streamerPollTimer = null;
    }
  }

  /**
   * Stops and disconnects the active StreamerNode and nulls the ref.
   */
  private teardownSource(): void {
    this.clearStreamerEndedPoller();
    if (this.streamerNode) {
      try {
        this.streamerNode.stop();
      } catch {
        // Already stopped — safe to ignore
      }
      this.streamerNode = null;
    }
  }

  private resetPositionTracking(): void {
    this.playStartContextTime = 0;
    this.playStartOffset = 0;
    this.pausedPosition = 0;
  }

  private setState(state: State): void {
    if (this._state === state) return;
    this._state = state;
    emitter.emit(Event.PlaybackState, { state });
  }

  /**
   * Ensures the AudioContext and GainNode are initialized, calling init() if needed.
   * init() is idempotent — safe to call multiple times.
   * This replaces the old assertReady() throw so callers no longer need to call
   * setupPlayer() / init() explicitly before using the engine.
   */
  private ensureReady(): void {
    if (!this.context || !this.gainNode) {
      this.init();
    }
  }

  /**
   * Appends (or replaces) a `timeOffset` query parameter on a URL.
   * Subsonic's /rest/stream endpoint accepts `timeOffset` (seconds) to begin
   * streaming at an offset into the track, enabling seek-on-stream.
   * For non-Subsonic URLs this param is harmless — unknown params are ignored.
   */
  private static urlWithTimeOffset(url: string, offsetSeconds: number): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('timeOffset', String(Math.floor(offsetSeconds)));
      return parsed.toString();
    } catch {
      // Malformed URL — return as-is
      return url;
    }
  }
}
