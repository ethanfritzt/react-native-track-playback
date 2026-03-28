import {
  AudioContext,
  decodeAudioData,
  type AudioBufferSourceNode,
  type GainNode,
  type AudioBuffer,
  type StreamerNode,
} from 'react-native-audio-api';
import { Event, State, Track } from './types';
import { emitter } from './EventEmitter';

/**
 * PlaybackEngine owns the AudioContext and source node lifecycle.
 *
 * ## Playback strategy
 *
 * The engine prefers StreamerNode (true HTTP streaming via FFmpeg) over the
 * legacy decodeAudioData + AudioBufferSourceNode approach:
 *
 *   - StreamerNode: calls context.createStreamer(), then streamer.initialize(url)
 *     and streamer.start(). Audio begins playing within ~1-2 seconds because the
 *     native layer starts decoding the stream progressively — no full-file download
 *     required before the first sample plays.
 *
 *   - Fallback (decodeAudioData): if context.createStreamer() returns null (FFmpeg
 *     build not enabled), the engine falls back to fetching and decoding the entire
 *     file into an AudioBuffer before playback starts. This causes the 15-20s delay
 *     on remote Subsonic streams.
 *
 * To enable StreamerNode, the react-native-audio-api plugin must be built with FFmpeg
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
 * This formula works identically for both StreamerNode and AudioBufferSourceNode.
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

  // --- AudioBufferSourceNode path (decodeAudioData fallback) ---
  private sourceNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;

  // --- StreamerNode path ---
  private streamerNode: StreamerNode | null = null;
  /** URL of the track currently loaded into the streamer (needed for seekTo). */
  private currentTrackUrl: string | null = null;
  /** Duration from track metadata — used instead of buffer.duration when streaming. */
  private currentTrackDuration: number = 0;

  // Prefetch cache — holds the decoded buffer for the next queued track.
  // Only used in the decodeAudioData fallback path.
  private prefetchBuffer: AudioBuffer | null = null;
  private prefetchUrl: string | null = null;

  // Position tracking
  private playStartContextTime: number = 0;
  private playStartOffset: number = 0;
  private pausedPosition: number = 0;

  private _state: State = State.None;

  /** Called by TrackPlayer when a track ends naturally (not via stop/skip). */
  private endedCallback: (() => void) | null = null;

  /**
   * True when the AudioContext's createStreamer() returned a non-null node,
   * indicating the FFmpeg build is available. Set on first init().
   * undefined = not yet tested.
   */
  private streamingAvailable: boolean | undefined = undefined;

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

    // Probe for StreamerNode availability once at init time.
    // createStreamer() returns null when the FFmpeg build is not enabled.
    if (this.streamingAvailable === undefined) {
      try {
        const probe = this.context.createStreamer();
        this.streamingAvailable = probe !== null;

        // Immediately stop the probe so the native layer can release its
        // resources (FFmpeg demuxer context, background thread, network
        // socket). Without this the probe node stays alive until GC runs,
        // which on Hermes/JSI is non-deterministic and can prevent subsequent
        // createStreamer() calls from succeeding if the native layer enforces
        // a single-active-streamer constraint.
        if (probe) {
          try {
            probe.stop();
          } catch {
            /* not started — safe to ignore */
          }
        }
      } catch {
        this.streamingAvailable = false;
      }
    }
  }

  async destroy(): Promise<void> {
    // Invalidate any in-flight load so its async continuation is a no-op
    this.loadGeneration++;
    this.teardownSource();
    this.currentBuffer = null;
    this.currentTrackUrl = null;
    this.currentTrackDuration = 0;
    this.prefetchBuffer = null;
    this.prefetchUrl = null;
    await this.context?.close();
    this.context = null;
    this.gainNode = null;
    // Reset so the next init() re-probes streaming availability on the new context
    this.streamingAvailable = undefined;
    this.setState(State.None);
  }

  // ---------------------------------------------------------------------------
  // Core playback
  // ---------------------------------------------------------------------------

  async loadAndPlay(track: Track, startOffset = 0): Promise<void> {
    this.assertReady();

    // Increment generation — any in-flight load from a previous call will
    // detect the mismatch at its next yield point and abort.
    const generation = ++this.loadGeneration;

    // Tear down previous source before changing state so onEnded doesn't fire
    this.teardownSource();
    this.setState(State.Loading);

    try {
      if (this.streamingAvailable) {
        await this.loadAndPlayStreamer(track, startOffset, generation);
      } else {
        await this.loadAndPlayBuffer(track, startOffset, generation);
      }
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
      // createStreamer() returned null at runtime despite probe succeeding —
      // fall back to buffer path.
      this.streamingAvailable = false;
      await this.loadAndPlayBuffer(track, startOffset, generation);
      return;
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

  /**
   * AudioBufferSourceNode path (fallback when FFmpeg / StreamerNode is unavailable).
   * Downloads and decodes the entire audio file before playback begins.
   */
  private async loadAndPlayBuffer(
    track: Track,
    startOffset: number,
    generation: number
  ): Promise<void> {
    let buffer: AudioBuffer;

    // Use prefetched buffer if the URL matches — avoids a redundant fetch
    if (this.prefetchUrl === track.url && this.prefetchBuffer) {
      buffer = this.prefetchBuffer;
      this.prefetchBuffer = null;
      this.prefetchUrl = null;
    } else {
      buffer = await decodeAudioData(track.url);

      // A newer loadAndPlay() fired while we were downloading — discard the
      // decoded buffer and exit. The newer load has already taken ownership.
      if (generation !== this.loadGeneration) return;
    }

    this.currentBuffer = buffer;
    this.currentTrackDuration = buffer.duration;

    // Resume context if previously suspended (e.g. after a pause from a previous track)
    if (this.context!.state === 'suspended') {
      await this.context!.resume();
    }

    // Check generation again after the async context.resume()
    if (generation !== this.loadGeneration) return;

    this.attachBufferSource(startOffset);
    this.setState(State.Playing);
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
  }

  async stop(): Promise<void> {
    // Invalidate any in-flight load
    this.loadGeneration++;
    this.teardownSource();
    this.currentBuffer = null;
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
    if (!this.currentTrackUrl && !this.currentBuffer) return;
    this.assertReady();

    const wasPlaying = this._state === State.Playing;

    // If paused, resume context first so currentTime is valid when we start
    if (this._state === State.Paused) {
      await this.context!.resume();
    }

    if (this.streamingAvailable && this.currentTrackUrl) {
      // Streamer path: tear down and re-initialize at the new offset.
      // StreamerNode doesn't support mid-stream seeking, so we must recreate it.
      this.teardownSource();

      const streamer = this.context!.createStreamer();
      if (streamer) {
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
      }
    } else {
      // Buffer path: tear down and re-attach at the new offset.
      this.teardownSource();
      this.attachBufferSource(seconds);
    }

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
  // Prefetching (buffer path only)
  // ---------------------------------------------------------------------------

  /**
   * Start decoding the next track in the background. The result is cached and
   * used by loadAndPlay() if the URL matches, avoiding a redundant fetch.
   * Failure is silently swallowed — loadAndPlay falls back to a fresh fetch.
   *
   * This is a no-op when StreamerNode is available, since streaming doesn't
   * need pre-decoded buffers.
   */
  async prefetchNext(track: Track): Promise<void> {
    // StreamerNode streams on-demand — no pre-fetching needed
    if (this.streamingAvailable) return;

    if (!this.context || track.url === this.prefetchUrl) return;
    try {
      const buffer = await decodeAudioData(track.url);
      this.prefetchBuffer = buffer;
      this.prefetchUrl = track.url;
    } catch {
      this.prefetchBuffer = null;
      this.prefetchUrl = null;
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
      const epsilon = 0.5;
      if (this.getPosition() >= this.currentTrackDuration - epsilon) {
        this.clearStreamerEndedPoller();
        this.setState(State.Ended);
        this.streamerNode = null;
        Promise.resolve(this.endedCallback?.()).catch((err: Error) => {
          emitter.emit(Event.PlaybackError, { message: err.message, code: -1 });
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
   * Creates a new AudioBufferSourceNode, connects it to the gain node, and
   * starts playback at the given offset. Buffer path only.
   */
  private attachBufferSource(offset: number): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.currentBuffer!;
    source.connect(this.gainNode!);

    /**
     * onEnded fires when the buffer plays through to its natural end.
     * It also fires when .stop() is called — so we guard with the current
     * state: only treat it as a natural end when we are still Playing.
     */
    source.onEnded = () => {
      source.onEnded = null;
      if (this._state === State.Playing) {
        this.setState(State.Ended);
        this.sourceNode = null;
        Promise.resolve(this.endedCallback?.()).catch((err: Error) => {
          emitter.emit(Event.PlaybackError, { message: err.message, code: -1 });
        });
      }
    };

    source.start(0, offset);

    this.playStartContextTime = ctx.currentTime;
    this.playStartOffset = offset;
    this.sourceNode = source;
  }

  /**
   * Stops and disconnects any active source node (streamer or buffer source)
   * and nulls the refs.
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

    if (this.sourceNode) {
      // Clear the callback first — stop() triggers onEnded on some platforms
      this.sourceNode.onEnded = null;
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped — safe to ignore
      }
      this.sourceNode = null;
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

  private assertReady(): void {
    if (!this.context || !this.gainNode) {
      throw new Error('PlaybackEngine: not initialized. Call TrackPlayer.setupPlayer() first.');
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
