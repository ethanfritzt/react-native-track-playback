import {
  AudioContext,
  decodeAudioData,
  type AudioBufferSourceNode,
  type GainNode,
  type AudioBuffer,
} from 'react-native-audio-api';
import { State, Track } from './types';
import { emitter } from './EventEmitter';

/**
 * PlaybackEngine owns the AudioContext and AudioBufferSourceNode lifecycle.
 *
 * Position tracking:
 *   context.currentTime stops incrementing when the context is suspended
 *   (per the RNAP docs). We therefore track position manually:
 *
 *   - playStartContextTime: context.currentTime value when source.start() was called
 *   - playStartOffset:      seek offset (seconds into the buffer) passed to start()
 *   - pausedPosition:       snapshot of position taken at the moment of suspension
 *
 *   While playing:  position = context.currentTime - playStartContextTime + playStartOffset
 *   While paused:   position = pausedPosition  (context.currentTime has stopped)
 *   Otherwise:      position = 0
 */
export class PlaybackEngine {
  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;

  // Prefetch cache — holds the decoded buffer for the next queued track
  private prefetchBuffer: AudioBuffer | null = null;
  private prefetchUrl: string | null = null;

  // Position tracking
  private playStartContextTime: number = 0;
  private playStartOffset: number = 0;
  private pausedPosition: number = 0;

  private _state: State = State.None;

  /** Called by TrackPlayer when a track ends naturally (not via stop/skip). */
  private endedCallback: (() => void) | null = null;

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
    this.teardownSource();
    this.currentBuffer = null;
    this.prefetchBuffer = null;
    this.prefetchUrl = null;
    await this.context?.close();
    this.context = null;
    this.gainNode = null;
    this.setState(State.None);
  }

  // ---------------------------------------------------------------------------
  // Core playback
  // ---------------------------------------------------------------------------

  async loadAndPlay(track: Track, startOffset = 0): Promise<void> {
    this.assertReady();
    // Tear down previous source before changing state so onEnded doesn't fire
    this.teardownSource();
    this.setState(State.Loading);

    try {
      let buffer: AudioBuffer;

      // Use prefetched buffer if the URL matches — avoids a redundant fetch
      if (this.prefetchUrl === track.url && this.prefetchBuffer) {
        buffer = this.prefetchBuffer;
        this.prefetchBuffer = null;
        this.prefetchUrl = null;
      } else {
        // Signal that we are now fetching / decoding the audio data
        this.setState(State.Buffering);
        buffer = await decodeAudioData(track.url);
      }

      this.currentBuffer = buffer;

      // Decode complete — signal ready before starting the source node
      this.setState(State.Ready);

      // If context was suspended (e.g. after a pause from a previous track),
      // resume it so playback actually starts
      if (this.context!.state === 'suspended') {
        await this.context!.resume();
      }

      this.attachSource(startOffset);
      this.setState(State.Playing);
    } catch (err) {
      this.setState(State.Error);
      throw err;
    }
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
    this.playStartContextTime = this.context!.currentTime - (this.pausedPosition - this.playStartOffset);
    this.setState(State.Playing);
  }

  async stop(): Promise<void> {
    this.teardownSource();
    this.currentBuffer = null;
    this.resetPositionTracking();
    // Resume context so it's ready for the next loadAndPlay call
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
    this.setState(State.Stopped);
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.currentBuffer) return;
    this.assertReady();

    const wasPlaying = this._state === State.Playing;

    // If paused, resume context first so currentTime is valid when we start
    if (this._state === State.Paused) {
      await this.context!.resume();
    }

    this.teardownSource();
    this.attachSource(seconds);

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
  // Prefetching
  // ---------------------------------------------------------------------------

  /**
   * Start decoding the next track in the background. The result is cached and
   * used by loadAndPlay() if the URL matches, avoiding a redundant fetch.
   * Failure is silently swallowed — loadAndPlay falls back to a fresh fetch.
   */
  async prefetchNext(track: Track): Promise<void> {
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
        return (
          this.context!.currentTime -
          this.playStartContextTime +
          this.playStartOffset
        );
      default:
        return 0;
    }
  }

  getDuration(): number {
    return this.currentBuffer?.duration ?? 0;
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
   * Creates a new AudioBufferSourceNode, connects it to the gain node, and
   * starts playback at the given offset.
   */
  private attachSource(offset: number): void {
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
      if (this._state === State.Playing) {
        this.setState(State.Ended);
        this.sourceNode = null;
        this.endedCallback?.();
      }
    };

    source.start(0, offset);

    this.playStartContextTime = ctx.currentTime;
    this.playStartOffset = offset;
    this.sourceNode = source;
  }

  /**
   * Stops and disconnects the current source node, nulls the ref, and clears
   * the onEnded handler so it doesn't fire spuriously after a manual stop/skip.
   */
  private teardownSource(): void {
    if (!this.sourceNode) return;
    // Clear the callback first — stop() triggers onEnded on some platforms
    this.sourceNode.onEnded = null;
    try {
      this.sourceNode.stop();
    } catch {
      // Already stopped — safe to ignore
    }
    this.sourceNode = null;
  }

  private resetPositionTracking(): void {
    this.playStartContextTime = 0;
    this.playStartOffset = 0;
    this.pausedPosition = 0;
  }

  private setState(state: State): void {
    if (this._state === state) return;
    this._state = state;
    emitter.emit('playback-state', { state });
  }

  private assertReady(): void {
    if (!this.context || !this.gainNode) {
      throw new Error(
        'PlaybackEngine: not initialized. Call TrackPlayer.setupPlayer() first.'
      );
    }
  }
}
