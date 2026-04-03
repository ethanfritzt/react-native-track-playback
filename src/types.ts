export interface Track {
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: string;
  duration?: number;
  // Open-ended: allow any extra fields callers pass through
  [key: string]: unknown;
}

/**
 * Patchable metadata fields on a Track — everything except `url`.
 * Used by updateMetadataForTrack() and updateNowPlayingMetadata() to update
 * track info after the track has already been queued (e.g. artwork arriving late).
 */
export type TrackMetadata = Omit<Track, 'url'>;

export enum State {
  None      = 'none',
  Loading   = 'loading',
  Buffering = 'buffering',
  Ready     = 'ready',
  Playing   = 'playing',
  Paused    = 'paused',
  Stopped   = 'stopped',
  Ended     = 'ended',
  Error     = 'error',
}

export enum Event {
  PlaybackState              = 'playback-state',
  PlaybackError              = 'playback-error',
  PlaybackActiveTrackChanged = 'playback-active-track-changed',
  RemotePlay                 = 'remote-play',
  RemotePause                = 'remote-pause',
  RemoteStop                 = 'remote-stop',
  RemoteNext                 = 'remote-next',
  RemotePrevious             = 'remote-previous',
  RemoteSeek                 = 'remote-seek',
}

export enum Capability {
  Play           = 'play',
  Pause          = 'pause',
  Stop           = 'stop',
  SkipToNext     = 'skip-to-next',
  SkipToPrevious = 'skip-to-previous',
  SeekTo         = 'seek-to',
}

export interface PlaybackState {
  state: State;
}

export interface Progress {
  position: number;
  duration: number;
  /** Always equals duration — the full buffer is decoded into memory. */
  buffered: number;
}

export interface ActiveTrackChangedEvent {
  track: Track | null;
  index: number;
  lastTrack: Track | null;
  lastIndex: number;
}

export interface UpdateOptions {
  capabilities?: Capability[];
}

/**
 * Emitted as the payload of `Event.PlaybackError`.
 *
 * Extends `Error` so consumers get a stack trace, can use `instanceof
 * PlaybackError`, and integrate naturally with error-monitoring tools.
 */
export class PlaybackError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'PlaybackError';
  }
}

/** Payload emitted with Event.RemoteSeek. */
export interface RemoteSeekEvent {
  position: number;
}

/**
 * Maps each Event value to the payload type its handler receives.
 * Used by the overloaded addEventListener signature to give callers
 * a fully-typed handler without any casts.
 */
export interface EventPayloadMap {
  [Event.PlaybackState]: PlaybackState;
  [Event.PlaybackError]: PlaybackError;
  [Event.PlaybackActiveTrackChanged]: ActiveTrackChangedEvent;
  [Event.RemotePlay]: void;
  [Event.RemotePause]: void;
  [Event.RemoteNext]: void;
  [Event.RemotePrevious]: void;
  [Event.RemoteSeek]: RemoteSeekEvent;
}

/** Returned by addEventListener — call remove() to unsubscribe. */
export interface Subscription {
  remove: () => void;
}
