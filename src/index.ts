/**
 * react-native-track-playback
 *
 * A React Native audio playback library built on react-native-audio-api.
 *
 * Usage:
 *   import TrackPlayer, { State, Event, Capability, usePlaybackState, useProgress }
 *     from 'react-native-track-playback';
 */

// Default export — the static TrackPlayer API
export { default } from './TrackPlayer';

// Named exports


// Types & enums
export type { Track, TrackMetadata, PlaybackState, PlaybackStateEvent, Progress, UpdateOptions, ActiveTrackChangedEvent, RemoteSeekEvent, EventPayloadMap, Subscription } from './types';
export { State, Event, Capability, PlaybackError } from './types';

// React hooks
export { usePlaybackState } from './hooks/usePlaybackState';
export { useProgress } from './hooks/useProgress';
