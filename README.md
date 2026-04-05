# react-native-track-playback

A React Native audio playback library built on [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api).

Provides queue-based audio playback with lock screen / notification controls, React hooks for UI state, and streaming support via FFmpeg for fast start (~1–2 seconds).

## Installation

Install via git reference (no registry publish yet):

```json
{
  "dependencies": {
    "react-native-track-playback": "github:ethanfritzt/react-native-track-playback#v0.1.0",
    "react-native-audio-api": ">=0.11.0"
  }
}
```

Then run:

```bash
npm install
```

### Peer Dependencies

| Package | Version |
|---|---|
| `react` | >= 18.0.0 |
| `react-native` | >= 0.73.0 |
| `react-native-audio-api` | >= 0.11.0 |
| `@expo/config-plugins` | >= 8.0.0 |

## Expo Setup

Add the config plugin to `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": ["react-native-track-playback"]
  }
}
```

The plugin automatically:
- Enables iOS background audio mode
- Enables Android foreground service and required permissions
- Ensures FFmpeg is enabled for streaming support

## Quick Start

```typescript
import TrackPlayer, { Event, State } from 'react-native-track-playback';

// Set a queue and start playing — no setup call required
await TrackPlayer.setQueue([
  {
    id: '1',
    url: 'https://example.com/track1.mp3',
    title: 'Track 1',
    artist: 'Artist Name',
    artwork: 'https://example.com/artwork.jpg',
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
const sub = TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
  console.log('state:', state);
});

// Unsubscribe when done
sub.remove();
```

### React Hooks

```typescript
import {
  usePlaybackState,
  useProgress,
  useActiveTrack,
} from 'react-native-track-playback';

function Player() {
  const { state } = usePlaybackState();
  const { position, duration } = useProgress(1000); // poll every 1000ms
  const track = useActiveTrack();

  return (
    <View>
      <Text>{track?.title ?? 'Nothing playing'}</Text>
      <Text>{state}</Text>
      <Text>{position.toFixed(1)} / {duration.toFixed(1)}s</Text>
    </View>
  );
}
```

## API Reference

### Queue Management

| Method | Signature | Description |
|---|---|---|
| `setQueue` | `(tracks: Track[]) => Promise<void>` | Replace the queue and start from the first track |
| `add` | `(tracks: Track[]) => void` | Append tracks to the end of the queue |
| `remove` | `(indexOrIndices: number \| number[] \| Track \| Track[]) => void` | Remove tracks by index or reference |
| `getQueue` | `() => readonly Track[]` | Return the current queue |
| `getTrack` | `(index: number) => Track \| undefined` | Return a track by index |
| `getActiveTrack` | `() => Track \| undefined` | Return the currently active track |
| `getActiveTrackIndex` | `() => number` | Return the active track's index |
| `updateMetadataForTrack` | `(index: number, metadata: TrackMetadata) => Promise<void>` | Update metadata for a queued track |
| `updateNowPlayingMetadata` | `(metadata: TrackMetadata) => Promise<void>` | Push metadata to the system now-playing display |

### Playback Control

| Method | Signature | Description |
|---|---|---|
| `play` | `() => Promise<void>` | Start or resume playback |
| `pause` | `() => Promise<void>` | Pause playback |
| `stop` | `() => Promise<void>` | Stop playback and reset position |
| `reset` | `() => Promise<void>` | Stop playback and clear the queue |
| `seekTo` | `(seconds: number) => Promise<void>` | Seek to a position in seconds |
| `skipToNext` | `() => Promise<void>` | Advance to the next track |
| `skipToPrevious` | `() => Promise<void>` | Go to the previous track, or restart if > 3s in |
| `getPlaybackState` | `() => PlaybackState` | Return `{ state, position, duration }` |
| `getProgress` | `() => Progress` | Return `{ position, duration }` |
| `updateOptions` | `(options: UpdateOptions) => Promise<void>` | Set which capabilities appear in system controls |
| `destroy` | `() => Promise<void>` | Tear down the player and release resources |

### React Hooks

#### `usePlaybackState()`

Returns `{ state: State | undefined }`. Re-renders on every playback state change.

```typescript
const { state } = usePlaybackState();
const isPlaying = state === State.Playing;
```

#### `useProgress(updateInterval?)`

Polls position and duration at the given interval (default: `1000` ms). Returns `{ position, duration }` in seconds.

```typescript
const { position, duration } = useProgress(500);
```

#### `useActiveTrack()`

Returns the active `Track` object, or `null` when nothing is queued. Updates automatically when the track changes.

```typescript
const track = useActiveTrack();
// track?.title, track?.artist, track?.artwork, …
```

### Events

Subscribe with `TrackPlayer.addEventListener(event, handler)` — returns a `Subscription` with a `.remove()` method.

| Event | Payload | Description |
|---|---|---|
| `Event.PlaybackState` | `PlaybackState` | Fired on every state transition |
| `Event.PlaybackError` | `PlaybackError` | Fired when a playback error occurs |
| `Event.PlaybackActiveTrackChanged` | `ActiveTrackChangedEvent` | Fired when the active track changes |
| `Event.RemotePlay` | `void` | Play triggered from lock screen / notification |
| `Event.RemotePause` | `void` | Pause triggered from lock screen / notification |
| `Event.RemoteNext` | `void` | Next triggered from lock screen / notification |
| `Event.RemotePrevious` | `void` | Previous triggered from lock screen / notification |
| `Event.RemoteSeek` | `RemoteSeekEvent` | Seek triggered from lock screen / notification |

### Types

```typescript
interface Track {
  id?: string;
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  artwork?: string;
  duration?: number;
}

enum State {
  None      = 'none',
  Loading   = 'loading',
  Buffering = 'buffering',
  Playing   = 'playing',
  Paused    = 'paused',
  Stopped   = 'stopped',
  Ended     = 'ended',
  Error     = 'error',
}

interface PlaybackState {
  state: State;
  position: number;  // seconds
  duration: number;  // seconds
}

interface Progress {
  position: number;  // seconds
  duration: number;  // seconds
}
```

## Contributing

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/ethanfritzt/react-native-track-playback.git
   cd react-native-track-playback
   npm install
   ```

2. Available scripts:

   | Script | Description |
   |---|---|
   | `npm run build` | Build (CJS + ESM + types) |
   | `npm run dev` | Watch mode |
   | `npm run typecheck` | Type-check without emitting |
   | `npm test` | Run the full test suite |
   | `npm run test:watch` | Run tests in watch mode |

3. Open a PR against `master`. All PRs must pass `npm test` and `npm run typecheck`.

## License

MIT
