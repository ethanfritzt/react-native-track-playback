# @ethanfritzt/react-native-playback

Queue-based audio playback for React Native, built on [`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api).

- Lock screen & notification controls (iOS + Android)
- Background audio
- HTTP streaming via FFmpeg (fast start, ~1–2 s)
- Fully typed API with React hooks
- Expo config plugin included

---

## Installation

```bash
npm install @ethanfritzt/react-native-playback react-native-audio-api
# or
yarn add @ethanfritzt/react-native-playback react-native-audio-api
```

### Peer dependencies

| Package | Version |
|---|---|
| `react` | ≥ 18.0.0 |
| `react-native` | ≥ 0.73.0 |
| `react-native-audio-api` | ≥ 0.11.0 |

> **Streaming support** requires the FFmpeg-enabled build of `react-native-audio-api`.
> Without FFmpeg the library falls back to full in-memory decoding before playback starts.

---

## Expo setup

Add the config plugin to `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      ["@ethanfritzt/react-native-playback", {
        "iosBackgroundMode": true,
        "androidForegroundService": true
      }]
    ]
  }
}
```

The plugin automatically:
- Enables iOS background audio mode
- Sets up an Android foreground service for background playback
- Adds required Android permissions
- Ensures the FFmpeg build of `react-native-audio-api` is used

---

## Quick start

```ts
import TrackPlayer, { Event } from '@ethanfritzt/react-native-playback';

await TrackPlayer.setQueue([
  {
    id: '1',
    url: 'https://example.com/track1.mp3',
    title: 'Track 1',
    artist: 'Artist Name',
    artwork: 'https://example.com/artwork.jpg',
    duration: 210,
  },
  {
    id: '2',
    url: 'https://example.com/track2.mp3',
    title: 'Track 2',
    artist: 'Artist Name',
  },
]);

await TrackPlayer.play();

// Listen to events
const sub = TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
  console.log('state:', e.state);
});

// Unsubscribe when done
sub.remove();
```

---

## API reference

### Queue management

| Method | Returns | Description |
|---|---|---|
| `setQueue(tracks)` | `Promise<void>` | Replace the queue and reset position |
| `add(tracks)` | `void` | Append tracks to the end of the queue |
| `remove(indexOrIndices)` | `void` | Remove track(s) by index or `Track` object |
| `getQueue()` | `readonly Track[]` | Current queue |
| `getTrack(index)` | `Track \| undefined` | Track at a specific index |
| `getActiveTrack()` | `Track \| undefined` | Currently active track |
| `getActiveTrackIndex()` | `number` | Index of the active track (`-1` if none) |
| `updateMetadataForTrack(index, metadata)` | `Promise<void>` | Patch metadata on a queued track in-place |
| `updateNowPlayingMetadata(metadata)` | `Promise<void>` | Update lock screen / notification without mutating the queue |

### Playback control

| Method | Returns | Description |
|---|---|---|
| `play()` | `Promise<void>` | Start or resume playback |
| `pause()` | `Promise<void>` | Pause playback |
| `stop()` | `Promise<void>` | Stop playback and reset position |
| `reset()` | `Promise<void>` | Stop playback and clear the queue |
| `seekTo(seconds)` | `Promise<void>` | Seek to position in seconds |
| `skipToNext()` | `Promise<void>` | Skip to the next track |
| `skipToPrevious(restartThreshold?)` | `Promise<void>` | Go to previous track, or restart if past threshold (default: 3 s) |
| `setVolume(volume)` | `Promise<void>` | Set playback volume, clamped to `[0, 1]` |

### State & progress

| Method | Returns | Description |
|---|---|---|
| `getPlaybackState()` | `PlaybackState` | Current state object `{ state: State }` |
| `getState()` | `State` | Current `State` enum value |
| `getPosition()` | `number` | Current position in seconds |
| `getDuration()` | `number` | Duration of the active track in seconds |
| `getProgress()` | `Progress` | `{ position, duration }` |

### Events

| Event | Payload type | Description |
|---|---|---|
| `Event.PlaybackState` | `PlaybackState` | Fired on every state change |
| `Event.PlaybackError` | `PlaybackError` | Fired when a playback error occurs |
| `Event.PlaybackActiveTrackChanged` | `ActiveTrackChangedEvent` | Fired when the active track changes |
| `Event.RemotePlay` | `void` | Play pressed on lock screen / notification |
| `Event.RemotePause` | `void` | Pause pressed on lock screen / notification |
| `Event.RemoteNext` | `void` | Next pressed on lock screen / notification |
| `Event.RemotePrevious` | `void` | Previous pressed on lock screen / notification |
| `Event.RemoteSeek` | `RemoteSeekEvent` | Seek triggered from lock screen / notification |

```ts
TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
  // e is fully typed as ActiveTrackChangedEvent — no casts needed
  console.log('now playing:', e.track?.title);
});
```

### Notification controls

```ts
import { Capability } from '@ethanfritzt/react-native-playback';

await TrackPlayer.updateOptions({
  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
    Capability.SeekTo,
  ],
});
```

---

## React hooks

### `usePlaybackState()`

Returns `{ state: State | undefined }`. Re-renders on every state change.

```tsx
import { usePlaybackState, State } from '@ethanfritzt/react-native-playback';

function PlayButton() {
  const { state } = usePlaybackState();
  const isPlaying = state === State.Playing;
  return <Button title={isPlaying ? 'Pause' : 'Play'} onPress={...} />;
}
```

### `useProgress(updateInterval?)`

Returns `{ position, duration }` in seconds. Polls at `updateInterval` ms (default: 1000). Snaps position immediately on resume.

```tsx
import { useProgress } from '@ethanfritzt/react-native-playback';

function ProgressBar() {
  const { position, duration } = useProgress(500);
  return <Slider value={position} maximumValue={duration} />;
}
```

### `useActiveTrack()`

Returns the active `Track | null`. Re-renders when the track changes. Initializes synchronously on mount — no null flash mid-playback.

```tsx
import { useActiveTrack } from '@ethanfritzt/react-native-playback';

function NowPlaying() {
  const track = useActiveTrack();
  return <Text>{track?.title ?? 'Nothing playing'}</Text>;
}
```

---

## Playback states

```ts
enum State {
  None      = 'none',      // Initial / destroyed
  Loading   = 'loading',   // Fetching / decoding audio
  Buffering = 'buffering', // Streaming, waiting for data
  Playing   = 'playing',
  Paused    = 'paused',
  Stopped   = 'stopped',
  Ended     = 'ended',     // Track finished naturally
  Error     = 'error',
}
```

---

## Track shape

```ts
interface Track {
  id?: string;
  url: string;        // required
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: string;   // URL or local path
  duration?: number;  // seconds; used by notification controls
}
```

---

## Contributing

```bash
git clone https://github.com/ethanfritzt/react-native-track-playback.git
cd react-native-track-playback
npm install
npm test
npm run typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the async/sync API policy and PR guidelines.

---

## License

MIT
