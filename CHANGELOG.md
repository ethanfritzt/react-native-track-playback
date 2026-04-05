# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-04

Initial release of `react-native-track-playback`.

### Added

- Queue-based audio playback built on `react-native-audio-api`
- `TrackPlayer` static API: `setQueue`, `add`, `remove`, `play`, `pause`, `stop`, `reset`, `seekTo`, `skipToNext`, `skipToPrevious`, `getQueue`, `getTrack`, `getActiveTrack`, `getActiveTrackIndex`, `updateMetadataForTrack`, `updateNowPlayingMetadata`, `getPlaybackState`, `getProgress`, `updateOptions`, `addEventListener`, `destroy`
- `getPlaybackState()` returns `{ state, position, duration }` — one call covers all player UI needs
- `usePlaybackState()` hook — synchronous init from engine state on mount
- `useProgress(updateInterval?)` hook — polls position/duration, snaps immediately on resume from pause
- `useActiveTrack()` hook — returns active `Track | null`, syncs to `PlaybackActiveTrackChanged` events
- Streaming support via FFmpeg for low-latency HTTP playback (~1–2 second start)
- Lock screen and notification controls via `react-native-audio-api` `PlaybackNotificationManager`
- Expo config plugin — enables iOS background audio, Android foreground service, FFmpeg
- `PlaybackError` class (extends `Error`) with `code` field for structured error handling
- Fully typed `addEventListener` via `EventPayloadMap` — no casts needed in handlers
- Auto-initialization on first use — no `setupPlayer()` call required
- `Track` type with `id?: string` first-class field; no index signature
- `UpdateOptions.capabilities` as a required field
- `State` enum: `None`, `Loading`, `Buffering`, `Playing`, `Paused`, `Stopped`, `Ended`, `Error`
- `Event` enum: `PlaybackState`, `PlaybackError`, `PlaybackActiveTrackChanged`, `RemotePlay`, `RemotePause`, `RemoteNext`, `RemotePrevious`, `RemoteSeek`, `RemoteStop`
- `Capability` enum: `Play`, `Pause`, `Stop`, `SkipToNext`, `SkipToPrevious`, `SeekTo`
- GitHub Actions CI workflow (typecheck + tests on every push/PR)
- ESLint + Prettier configuration

### Fixed

- `onEnded` handler self-clears to prevent duplicate fire on track transition
- Auto-advance errors propagate as `PlaybackError` instead of being swallowed
- `PlaybackActiveTrackChanged(null)` emitted and engine stopped at end of queue
- `setQueue()` does not auto-start playback (explicit `play()` required)
- `useProgress` shows position and duration immediately on track change
- Engine stopped on `setQueue()` to handle stale in-flight loads correctly
- `PlaybackActiveTrackChanged` emitted on `play()`, `stop()`, and `reset()`

### Changed

- `setupPlayer()` removed — auto-initialization replaces it
- Pure queue-mutation methods (`add`, `remove`, `getQueue`, etc.) are synchronous; only methods touching the audio engine return `Promise<void>`
- `State.Ready` removed — no longer meaningful with auto-initialization
- `Track` index signature `[key: string]: unknown` removed
