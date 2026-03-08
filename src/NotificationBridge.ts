import { PlaybackNotificationManager } from 'react-native-audio-api';
import { Capability, Event, State, Track } from './types';
import { emitter } from './EventEmitter';

/**
 * Maps react-native-audio-api's PlaybackNotificationManager events to the
 * RNTP-style Event.* callbacks that consumers register via addEventListener().
 *
 * Also handles updating the lock screen / notification metadata whenever
 * the active track or playback state changes.
 */

// Maps our Capability enum values to RNAP's PlaybackControlName strings
const CAPABILITY_TO_CONTROL: Partial<Record<Capability, string>> = {
  [Capability.Play]:           'play',
  [Capability.Pause]:          'pause',
  // Note: RNAP has no 'stop' control — omit it; stop is handled by the app
  [Capability.SkipToNext]:     'next',
  [Capability.SkipToPrevious]: 'previous',
  [Capability.SeekTo]:         'seekTo',
};

type RNAPSubscription = { remove: () => void };

export class NotificationBridge {
  private subscriptions: RNAPSubscription[] = [];
  private isSetup = false;

  // ---------------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------------

  async setup(capabilities: Capability[]): Promise<void> {
    this.teardown();

    // Enable only the requested controls; disable everything else.
    // We iterate over all known RNAP control names to ensure unused ones are
    // explicitly disabled (RNAP doesn't disable by default).
    const allRNAPControls = ['play', 'pause', 'next', 'previous', 'skipForward', 'skipBackward', 'seekTo'] as const;
    for (const control of allRNAPControls) {
      const isEnabled = capabilities.some(
        cap => CAPABILITY_TO_CONTROL[cap] === control
      );
      await PlaybackNotificationManager.enableControl(control, isEnabled);
    }

    // Wire RNAP notification events → package EventEmitter (RNTP Event.* shape)
    this.subscriptions = [
      PlaybackNotificationManager.addEventListener(
        'playbackNotificationPlay',
        () => emitter.emit(Event.RemotePlay)
      ),
      PlaybackNotificationManager.addEventListener(
        'playbackNotificationPause',
        () => emitter.emit(Event.RemotePause)
      ),
      // Note: RNAP has no 'stop' notification event. RemoteStop is not wired
      // here — it fires only from app-level calls to TrackPlayer.stop().
      PlaybackNotificationManager.addEventListener(
        'playbackNotificationNext',
        () => emitter.emit(Event.RemoteNext)
      ),
      PlaybackNotificationManager.addEventListener(
        'playbackNotificationPrevious',
        () => emitter.emit(Event.RemotePrevious)
      ),
      PlaybackNotificationManager.addEventListener(
        'playbackNotificationSeekTo',
        (event: { value: number }) => emitter.emit(Event.RemoteSeek, { position: event.value })
      ),
    ];

    this.isSetup = true;
  }

  teardown(): void {
    this.subscriptions.forEach(s => s.remove());
    this.subscriptions = [];
    this.isSetup = false;
  }

  // ---------------------------------------------------------------------------
  // Now-playing metadata
  // ---------------------------------------------------------------------------

  /**
   * Update the system notification / lock screen with current track info.
   *
   * iOS note: metadata is remembered between calls, so only changed fields
   * need to be passed. We always pass the full set to keep things simple.
   *
   * iOS note: elapsedTime does NOT update automatically — it must be set
   * manually on each state change, which is why we require `position` here.
   */
  async updateNowPlaying(
    track: Track,
    state: State,
    position: number
  ): Promise<void> {
    if (!this.isSetup) return;

    const notifState: 'playing' | 'paused' =
      state === State.Playing ? 'playing' : 'paused';

    await PlaybackNotificationManager.show({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork as string | { uri: string } | undefined,
      duration: track.duration,
      elapsedTime: position,
      state: notifState,
    });
  }

  async hide(): Promise<void> {
    await PlaybackNotificationManager.hide();
  }
}
