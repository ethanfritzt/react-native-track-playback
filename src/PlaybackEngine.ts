import { Event, State, Track, PlaybackError } from './types';
import { emitter } from './EventEmitter';
import { AudioTagHandle } from 'react-native-audio-api';

type TrackChangeListener = (track: Track | null) => void;

export class PlaybackEngine {
  private currentTrackUrl: string | null = null;
  private currentTrackDuration = 0;

  private _state: State = State.None;
  private endedCallback: (() => void) | null = null;

  private audioHandle: AudioTagHandle | null = null;
  private trackListeners = new Set<TrackChangeListener>();
  private currentPosition = 0;

  attach(handle: AudioTagHandle | null): void {
    this.audioHandle = handle;
  }

  subscribeToTrack(listener: TrackChangeListener): () => void {
    this.trackListeners.add(listener);

    return () => {
      this.trackListeners.delete(listener);
    }
  }

  setPosition(position: number): void {
    this.currentPosition = position;
  }

  getPosition(): number {
    return this.currentPosition;
  }

  seekTo(seconds: number): void {
    if (!this.audioHandle) {
      return;
    }

    this.audioHandle.seekToTime(seconds);
    this.currentPosition = seconds;
  }

  handlePlaying(): void {
    return this.setState(State.Playing);
  }

  handlePaused(): void {
    return this.setState(State.Paused);
  }

  handleEnded(): void {
    this.setState(State.Ended)
    this.endedCallback?.();
  }

  handleOnError(error: Error): void {
    this.setState(State.Error);

    emitter.emit(Event.PlaybackError, new PlaybackError(error.message, -1))
  }

  // note: do we even need this?
  loadAndPlay(track: Track): void {
    this.notifyTrackChanged(track);
    this.setState(State.Loading);

    this.currentTrackUrl = track?.url;
    this.currentTrackDuration = track?.duration ?? 0;
  }

  private notifyTrackChanged(track: Track | null): void {
    this.trackListeners.forEach((listener) => listener(track))
  }

  pause(): void {
    // if (this._state !== State.Playing) return;

    this.audioHandle?.pause();
  }

  resume(): void {
    if (this._state !== State.Paused) return;

    this.audioHandle?.play();
  }

  stop(): void {
    this.currentPosition = 0;
    this.currentTrackUrl = null;
    this.currentTrackDuration = 0;
    this.setState(State.Stopped);

    this.audioHandle?.pause();
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

  private setState(state: State): void {
    if (this._state === state) return;
    this._state = state;
    emitter.emit(Event.PlaybackState, { state });
  }
}

export const playbackEngine = new PlaybackEngine();
