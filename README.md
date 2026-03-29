# react-native-track-playback

A React Native audio playback library built on [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api).

## Overview

This library provides queue-based audio playback with lock screen and notification controls, leveraging `react-native-audio-api` for audio output.

**Key Features:**

- Queue management with shuffle support
- Playback controls (play, pause, seek, skip)
- Lock screen and notification controls
- Background audio playback
- React hooks for state management
- Streaming support via FFmpeg for fast playback start (~1-2 seconds)

## Installation

```bash
npm install react-native-track-playback react-native-audio-api
# or
yarn add react-native-track-playback react-native-audio-api
```

### Peer Dependencies

| Package | Version |
|---------|---------|
| `react` | >= 18.0.0 |
| `react-native` | >= 0.73.0 |
| `react-native-audio-api` | >= 0.11.0 |

## Expo Setup

If you're using Expo, add the config plugin to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": ["react-native-track-playback"]
  }
}
```

The plugin automatically:
- Enables iOS background audio mode
- Enables Android foreground service
- Adds required Android permissions
- Ensures FFmpeg is enabled for streaming support

## Quick Start

```typescript
import TrackPlayer, { State, Event } from 'react-native-track-playback';

// Set up the queue
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

// Start playback
await TrackPlayer.play();

// Listen for events
TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
  console.log('Playback state:', event.state);
});
```

### Using React Hooks

```typescript
import { usePlaybackState, useProgress } from 'react-native-track-playback';

function Player() {
  const playbackState = usePlaybackState();
  const { position, duration } = useProgress(1000); // Update every 1000ms

  return (
    <View>
      <Text>State: {playbackState}</Text>
      <Text>Progress: {position} / {duration}</Text>
    </View>
  );
}
```

## API Reference

### Queue Management

| Method | Description |
|--------|-------------|
| `setQueue(tracks)` | Replace the current queue with new tracks |
| `add(tracks, insertBeforeIndex?)` | Add tracks to the queue |
| `remove(indices)` | Remove tracks at specified indices |
| `move(fromIndex, toIndex)` | Move a track within the queue |
| `getQueue()` | Get the current queue |
| `getActiveTrack()` | Get the currently active track |
| `getActiveTrackIndex()` | Get the index of the active track |
| `updateMetadataForTrack(index, metadata)` | Update metadata for a track |
| `shuffle()` | Shuffle the queue (Fisher-Yates algorithm) |

### Playback Control

| Method | Description |
|--------|-------------|
| `play()` | Start or resume playback |
| `pause()` | Pause playback |
| `stop()` | Stop playback and reset position |
| `reset()` | Stop playback and clear the queue |
| `seekTo(position)` | Seek to a position in seconds |
| `skip(index)` | Skip to a specific track index |
| `skipToNext()` | Skip to the next track |
| `skipToPrevious()` | Skip to previous track (or restart if > 3 seconds in) |
| `getPlaybackState()` | Get the current playback state |
| `getProgress()` | Get current position and duration |

### Events

| Event | Description |
|-------|-------------|
| `Event.PlaybackState` | Fired when playback state changes |
| `Event.PlaybackActiveTrackChanged` | Fired when the active track changes |
| `Event.RemotePlay` | Fired when play is triggered from lock screen/notification |
| `Event.RemotePause` | Fired when pause is triggered from lock screen/notification |
| `Event.RemoteNext` | Fired when next is triggered from lock screen/notification |
| `Event.RemotePrevious` | Fired when previous is triggered from lock screen/notification |
| `Event.RemoteSeek` | Fired when seek is triggered from lock screen/notification |
| `Event.PlaybackError` | Fired when a playback error occurs |

```typescript
// Subscribe to events
const subscription = TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
  console.log('State:', event.state);
});

// Unsubscribe when done
subscription.remove();
```

### React Hooks

#### `usePlaybackState()`

Returns the current playback state. Re-renders when the state changes.

```typescript
const state = usePlaybackState();
// Returns: State.None | State.Playing | State.Paused | State.Stopped | ...
```

#### `useProgress(updateInterval?)`

Returns the current playback progress. Polls at the specified interval (default: 1000ms).

```typescript
const { position, duration } = useProgress(500);
```

### Playback States

```typescript
enum State {
  None = 'none',
  Ready = 'ready',
  Playing = 'playing',
  Paused = 'paused',
  Stopped = 'stopped',
  Ended = 'ended',
  Loading = 'loading',
  Error = 'error',
}
```

## Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/react-native-track-playback.git
   cd react-native-track-playback
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development mode:
   ```bash
   npm run dev
   ```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build the library (CJS + ESM + types) |
| `npm run dev` | Watch mode for development |
| `npm run typecheck` | Run TypeScript type checking |
| `npm test` | Run the test suite |
| `npm run test:watch` | Run tests in watch mode |

### Running Tests

```bash
npm test
```

Tests use Jest with a comprehensive mock of `react-native-audio-api`. The test suite covers:
- Queue management operations
- Playback state transitions
- Event emission and handling
- Hook behavior

### Pull Request Guidelines

1. Fork the repository and create a feature branch
2. Make your changes with clear, descriptive commits
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Ensure TypeScript compiles (`npm run typecheck`)
6. Submit a pull request with a clear description of your changes

## License

MIT
