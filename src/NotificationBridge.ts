import { PlaybackNotificationManager } from 'react-native-audio-api';
import { Control, Event, State, Track } from './types';
import { emitter } from './EventEmitter';

/**
 * Maps react-native-audio-api's PlaybackNotificationManager events to the
 * Event.* callbacks that consumers register via addEventListener().
 *
 * Also handles updating the lock screen / notification metadata whenever
 * the active track or playback state changes.
 */

type RNAPSubscription = { remove: () => void };

export class NotificationBridge {
  private subscriptions: RNAPSubscription[] = [];
  private isSetup = false;
  /**
   * Tracks the last-applied enabled/disabled state for each RNAP control name.
   * Used by setup() to skip enableControl calls for controls that haven't changed,
   * avoiding unnecessary async work when updateOptions() is called more than once.
   */
  private appliedControls: Map<string, boolean> = new Map();

  // ---------------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------------

  async setup(controls: Control[]): Promise<void> {
    this.teardown();

    // Enable only the requested controls; disable everything else.
    // We iterate over all known RNAP control names to ensure unused ones are
    // explicitly disabled (RNAP doesn't disable by default).
    // Only controls whose enabled/disabled state has changed since the last
    // setup() call are sent — this avoids redundant async work when
    // updateOptions() is called more than once (e.g. per-track control changes).
    const allRNAPControls = ['play', 'pause', 'next', 'previous', 'skipForward', 'skipBackward', 'seekTo'] as const;
    const changed = allRNAPControls.filter(control => {
      const isEnabled = (controls as string[]).includes(control);
      return this.appliedControls.get(control) !== isEnabled;
    });

    await Promise.all(
      changed.map(control => {
        const isEnabled = (controls as string[]).includes(control);
        this.appliedControls.set(control, isEnabled);
        return PlaybackNotificationManager.enableControl(control, isEnabled);
      })
    );

    // Wire RNAP notification events → package EventEmitter
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
    this.appliedControls.clear();
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
