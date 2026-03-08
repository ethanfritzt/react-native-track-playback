/**
 * react-native-track-playback
 *
 * Drop-in replacement for react-native-track-player, built on react-native-audio-api.
 *
 * Usage:
 *   import TrackPlayer, { State, Event, Capability, usePlaybackState, useProgress }
 *     from 'react-native-track-playback';
 */

// Default export — the static TrackPlayer API (mirrors RNTP's default export)
export { default } from './TrackPlayer';

// Named exports — mirrors RNTP's named exports
export { registerPlaybackService } from './TrackPlayer';

// Types & enums
export type { Track, PlaybackState, Progress, UpdateOptions, ActiveTrackChangedEvent, SeekEvent } from './types';
export { State, Event, Capability } from './types';

// React hooks
export { usePlaybackState } from './hooks/usePlaybackState';
export { useProgress } from './hooks/useProgress';
