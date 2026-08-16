import { Event, State, PlaybackError } from './types';
import { emitter } from './EventEmitter';
import { AudioTagHandle } from 'react-native-audio-api';
import TrackPlayer from './TrackPlayer';

export class PlaybackEngine {
  private _state: State = State.None;
  private audioHandle: AudioTagHandle | null = null;
  private currentTrackDuration = 0;
  private currentPosition = 0;

  // core player functionality
  //
  attach(handle: AudioTagHandle | null): void {
    this.audioHandle = handle;
  }

  pause(): void {
    if (this._state !== State.Playing) return;

    this.audioHandle?.pause();
  }

  resume(): void {
    if (this._state !== State.Paused) return;

    this.audioHandle?.play();
  }

  stop(): void {
    this.currentPosition = 0;
    this.currentTrackDuration = 0;
    this.setState(State.Stopped);

    this.audioHandle?.pause();
  }

  seekTo(seconds: number): void {
    if (!this.audioHandle) {
      return;
    }

    this.audioHandle.seekToTime(seconds);
    this.currentPosition = seconds;
  }

  // getters and setters
  //
  private setState(state: State): void {
    if (this._state === state) return;
    this._state = state;
    emitter.emit(Event.PlaybackState, { state });
  }

  getState(): State {
    return this._state;
  }

  setPosition(position: number): void {
    this.currentPosition = position;
  }

  getPosition(): number {
    return this.currentPosition;
  }

  setDuration(seconds: number): void {
    this.currentTrackDuration = seconds;
  }

  getDuration(): number {
    return this.currentTrackDuration;
  }

  // handlers
  //
  handlePlaying(): void {
    return this.setState(State.Playing);
  }

  handlePaused(): void {
    return this.setState(State.Paused);
  }

  handleEnded(): void {
    this.setState(State.Ended);
    TrackPlayer.skipToNext();
  }

  handleOnError(error: Error): void {
    this.setState(State.Error);

    emitter.emit(Event.PlaybackError, new PlaybackError(error.message, -1))
  }
}

export const playbackEngine = new PlaybackEngine();
