import { Event, State, Track, PlaybackError } from './types';
import { emitter } from './EventEmitter';
import {
  playbackAudioApi,
  type AudioBuffer,
  type AudioBufferSourceNode,
  type GainNode,
  type StreamerNode,
  type PlaybackAudioApi,
  type PlaybackAudioContext,
} from './audioContext';

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
 *     native layer starts decoding the stream progressively, no full-file download
 *     required before the first sample plays.
 *
 *   - Fallback (decode path): if context.createStreamer() returns null (FFmpeg
 *     build not enabled), the engine falls back to fetching and decoding the entire
 *     file into an AudioBuffer before playback starts.
 *
 * To enable StreamerNode, the react-native-audio-api plugin must be built with FFmpeg.
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
 *   track-changes never leave a stale source running or corrupt the engine state.
 */
export class PlaybackEngine {
  private context: PlaybackAudioContext | null = null;
  private gainNode: GainNode | null = null;

  // Buffer fallback path
  private sourceNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;

  // Streamer path
  private streamerNode: StreamerNode | null = null;
  private currentTrackUrl: string | null = null;
  private currentTrackDuration = 0;

  // Prefetch cache for buffer fallback
  private prefetchBuffer: AudioBuffer | null = null;
  private prefetchUrl: string | null = null;

  // Position tracking
  private playStartContextTime = 0;
  private playStartOffset = 0;
  private pausedPosition = 0;

  private _state: State = State.None;
  private endedCallback: (() => void) | null = null;
  private streamingAvailable: boolean | undefined = undefined;
  private loadGeneration = 0;
  private streamerPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly audioApi: PlaybackAudioApi = playbackAudioApi) {}

  init(): void {
    if (this.context) return;
    this.context = this.audioApi.createContext();
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);

    if (this.streamingAvailable === undefined) {
      try {
        const probe = this.context.createStreamer();
        this.streamingAvailable = probe !== null;
        if (probe) {
          try {
            probe.stop();
          } catch {
            // ignore
          }
        }
      } catch {
        this.streamingAvailable = false;
      }
    }
  }

  async destroy(): Promise<void> {
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
    this.streamingAvailable = undefined;
    this.setState(State.None);
  }

  async loadAndPlay(track: Track, startOffset = 0): Promise<void> {
    this.ensureReady();
    const generation = ++this.loadGeneration;
    this.teardownSource();
    this.setState(State.Loading);

    try {
      if (this.streamingAvailable) {
        await this.loadAndPlayStreamer(track, startOffset, generation);
      } else {
        await this.loadAndPlayBuffer(track, startOffset, generation);
      }
    } catch (err) {
      if (generation === this.loadGeneration) {
        this.setState(State.Error);
      }
      throw err;
    }
  }

  private async loadAndPlayStreamer(
    track: Track,
    startOffset: number,
    generation: number
  ): Promise<void> {
    const streamer = this.context!.createStreamer();
    if (!streamer) {
      this.streamingAvailable = false;
      await this.loadAndPlayBuffer(track, startOffset, generation);
      return;
    }

    streamer.connect(this.gainNode!);

    const streamUrl =
      startOffset > 0 ? PlaybackEngine.urlWithTimeOffset(track.url, startOffset) : track.url;

    const ok = streamer.initialize(streamUrl);
    if (!ok) {
      throw new Error(`StreamerNode: failed to initialize stream for URL: ${streamUrl}`);
    }

    if (this.context!.state === 'suspended') {
      await this.context!.resume();
    }

    if (generation !== this.loadGeneration) {
      try {
        streamer.stop();
      } catch {
        // ignore
      }
      return;
    }

    streamer.start(0);

    this.playStartContextTime = this.context!.currentTime;
    this.playStartOffset = startOffset;
    this.streamerNode = streamer;
    this.currentTrackUrl = track.url;
    this.currentTrackDuration = track.duration ?? 0;

    this.setState(State.Playing);
    this.startStreamerEndedPoller(streamer);
  }

  private async loadAndPlayBuffer(
    track: Track,
    startOffset: number,
    generation: number
  ): Promise<void> {
    let buffer: AudioBuffer;

    if (this.prefetchUrl === track.url && this.prefetchBuffer) {
      buffer = this.prefetchBuffer;
      this.prefetchBuffer = null;
      this.prefetchUrl = null;
    } else {
      buffer = await this.audioApi.decode(track.url);
      if (generation !== this.loadGeneration) return;
    }

    this.currentBuffer = buffer;
    this.currentTrackDuration = buffer.duration;
    this.currentTrackUrl = track.url;

    if (this.context!.state === 'suspended') {
      await this.context!.resume();
    }

    if (generation !== this.loadGeneration) return;

    this.attachBufferSource(startOffset);
    this.setState(State.Playing);
  }

  async pause(): Promise<void> {
    if (this._state !== State.Playing) return;
    this.pausedPosition = this.getPosition();
    await this.context!.suspend();
    this.setState(State.Paused);
  }

  async resume(): Promise<void> {
    if (this._state !== State.Paused) return;
    await this.context!.resume();
    this.playStartContextTime =
      this.context!.currentTime - (this.pausedPosition - this.playStartOffset);
    this.setState(State.Playing);
    if (this.streamerNode) {
      this.startStreamerEndedPoller(this.streamerNode);
    }
  }

  async stop(): Promise<void> {
    this.loadGeneration++;
    this.teardownSource();
    this.currentBuffer = null;
    this.currentTrackUrl = null;
    this.currentTrackDuration = 0;
    this.resetPositionTracking();
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
    this.setState(State.Stopped);
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.currentTrackUrl) return;
    this.ensureReady();

    const wasPlaying = this._state === State.Playing;

    if (this._state === State.Paused) {
      await this.context!.resume();
    }

    this.teardownSource();

    if (this.streamingAvailable) {
      const streamer = this.context!.createStreamer();
      if (!streamer) {
        this.streamingAvailable = false;
        if (this.currentBuffer) {
          this.attachBufferSource(seconds);
          if (wasPlaying) {
            this.setState(State.Playing);
          } else {
            this.pausedPosition = seconds;
            await this.context!.suspend();
            this.setState(State.Paused);
          }
        } else {
          this.setState(State.Error);
        }
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
      // Use Math.floor to match the integer offset sent in the timeOffset URL param.
      // Without this, the position formula drifts by up to 1s after a streamer seek.
      this.playStartOffset = Math.floor(seconds);
      this.streamerNode = streamer;
      this.startStreamerEndedPoller(streamer);

      if (wasPlaying) {
        this.setState(State.Playing);
      } else {
        this.pausedPosition = seconds;
        await this.context!.suspend();
        this.setState(State.Paused);
      }
      return;
    }

    if (!this.currentBuffer) return;
    this.attachBufferSource(seconds);
    if (wasPlaying) {
      this.setState(State.Playing);
    } else {
      this.pausedPosition = seconds;
      await this.context!.suspend();
      this.setState(State.Paused);
    }
  }

  async prefetchNext(track: Track): Promise<void> {
    if (this.streamingAvailable) return;
    if (!this.context || track.url === this.prefetchUrl) return;
    try {
      const buffer = await this.audioApi.decode(track.url);
      this.prefetchBuffer = buffer;
      this.prefetchUrl = track.url;
    } catch {
      this.prefetchBuffer = null;
      this.prefetchUrl = null;
    }
  }

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

  onTrackEnded(cb: () => void): void {
    this.endedCallback = cb;
  }

  private startStreamerEndedPoller(streamer: StreamerNode): void {
    this.clearStreamerEndedPoller();
    if (this.currentTrackDuration <= 0) return;

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

  private attachBufferSource(startOffset: number): void {
    const source = this.context!.createBufferSource();
    source.buffer = this.currentBuffer!;
    source.connect(this.gainNode!);
    source.onEnded = () => {
      if (this.sourceNode !== source) return;
      this.sourceNode = null;
      this.setState(State.Ended);
      Promise.resolve(this.endedCallback?.()).catch((err: Error) => {
        emitter.emit(Event.PlaybackError, new PlaybackError(err.message, -1));
      });
    };
    source.start(0, startOffset);
    this.sourceNode = source;
    this.playStartContextTime = this.context!.currentTime;
    this.playStartOffset = startOffset;
  }

  private teardownSource(): void {
    this.clearStreamerEndedPoller();
    if (this.streamerNode) {
      try {
        this.streamerNode.stop();
      } catch {
        // ignore
      }
      this.streamerNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // ignore
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

  private ensureReady(): void {
    if (!this.context || !this.gainNode) {
      this.init();
    }
  }

  private static urlWithTimeOffset(url: string, offsetSeconds: number): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('timeOffset', String(Math.floor(offsetSeconds)));
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

