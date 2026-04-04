# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-04

### Added

- Initial release as `@ethanfritzt/react-native-playback`
- **StreamerNode path** — HTTP streaming via FFmpeg (react-native-audio-api) for fast playback start (~1–2 s)
- **AudioBufferSourceNode fallback** — full in-memory decode for non-FFmpeg builds
- **Queue management** — `setQueue`, `add`, `remove`, `getQueue`, `getTrack`, `getActiveTrack`, `getActiveTrackIndex`, `updateMetadataForTrack`, `updateNowPlayingMetadata`
- **Playback control** — `play`, `pause`, `stop`, `reset`, `seekTo`, `skipToNext`, `skipToPrevious`
- **`skipToPrevious(restartThreshold?)`** — configurable restart threshold (default 3 s); set to 0 to always skip back
- **`setVolume(volume)`** — real-time volume control clamped to [0, 1] via GainNode
- **`PlaybackError` class** — `Event.PlaybackError` payloads now extend `Error` (stack traces, `instanceof` checks)
- **Typed `addEventListener`** — generic `<E extends Event>` overload with `EventPayloadMap`; no `as any` casts needed at call sites
- **Auto-initialization** — `setupPlayer()` is now optional; the engine initializes on first method call
- **`usePlaybackState()`** hook — reactive playback state, syncs on mount
- **`useProgress(updateInterval?)`** hook — polls position/duration; snaps immediately on resume from pause
- **`useActiveTrack()`** hook — reactive active track, initializes synchronously on mount
- **Expo config plugin** — `iosBackgroundMode` and `androidForegroundService` options; auto-enables FFmpeg build
- **`CONTRIBUTING.md`** — documents the async/sync API policy
- Lock screen and system notification controls via `react-native-audio-api` PlaybackNotificationManager

### Changed

- Renamed from `react-native-track-playback` → `@ethanfritzt/react-native-playback`
- Repositioned as an independent audio library, not an RNTP replacement
- **`Track` type** — removed `[key: string]: unknown` index signature; added `id?: string` as a first-class field
- **`UpdateOptions.capabilities`** — now required (was optional); prevents silent no-op when passing `{}`
- **`Progress`** — `buffered` field removed (always equalled `duration`)
- **Async API normalized** — pure query methods (`getQueue`, `getActiveTrack`, `getState`, `getPosition`, `getDuration`, `getProgress`, `getPlaybackState`, `add`, `remove`) are now synchronous
- **StreamerNode end-detection epsilon** reduced from 0.5 s to 0.1 s — eliminates premature track-end
- **`setupPlayer()`** marked `@deprecated` — safe to remove from consuming apps

### Removed

- `Progress.buffered` — always equalled `duration`; removed to eliminate misleading API surface
- `Capability.Stop` — RNTP artifact; RNAP has no stop notification control
- `Event.RemoteStop` — RNTP artifact; was never emitted from any hardware action
- `State.Ready` — had no meaningful emit point; engine initializes lazily
- `getPosition()`, `getDuration()`, `getState()` as top-level `async` methods — replaced by synchronous versions

[Unreleased]: https://github.com/ethanfritzt/react-native-track-playback/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ethanfritzt/react-native-track-playback/releases/tag/v0.1.0
