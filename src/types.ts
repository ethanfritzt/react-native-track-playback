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
