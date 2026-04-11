export interface Track {
  id?: string;
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: string;
  duration?: number;
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

export enum Control {
  Play          = 'play',
  Pause         = 'pause',
  NextTrack     = 'nextTrack',
  PreviousTrack = 'previousTrack',
  SkipForward   = 'skipForward',
  SkipBackward  = 'skipBackward',
  SeekTo        = 'seekTo',
}

export interface PlaybackState {
  state: State;
  position: number;
  duration: number;
}

export interface Progress {
  position: number;
  duration: number;
}

export interface ActiveTrackChangedEvent {
  track: Track | null;
  index: number;
  lastTrack: Track | null;
  lastIndex: number;
}

/**
 * Optional overrides for remote control events. Each key corresponds to a
 * remote event; if provided, the function replaces the default handler for
 * that event. If omitted, the default behavior is used.
 */
export interface RemoteHandlers {
  onRemotePlay?: () => void | Promise<void>;
  onRemotePause?: () => void | Promise<void>;
  onRemoteStop?: () => void | Promise<void>;
  onRemoteNext?: () => void | Promise<void>;
  onRemotePrevious?: () => void | Promise<void>;
  onRemoteSeek?: (event: RemoteSeekEvent) => void | Promise<void>;
}

/**
 * Options passed to TrackPlayer.updateOptions().
 *
 * @param controls - Controls shown in the system media notification /
 *   lock screen. Maps to RNAP's PlaybackNotificationManager.enableControl().
 *   Only the listed capabilities are enabled; all others are explicitly
 *   disabled. Defaults to all capabilities disabled if omitted.
 * @param remoteHandlers - Optional per-event overrides for remote control
 *   events. Omitting a handler uses the default behavior; providing one
 *   replaces it entirely.
 */
export interface UpdateOptions {
  controls: Control[];
  remoteHandlers?: RemoteHandlers;
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
  [Event.RemoteStop]: void;
  [Event.RemoteNext]: void;
  [Event.RemotePrevious]: void;
  [Event.RemoteSeek]: RemoteSeekEvent;
}

/** Returned by addEventListener — call remove() to unsubscribe. */
export interface Subscription {
  remove: () => void;
}
