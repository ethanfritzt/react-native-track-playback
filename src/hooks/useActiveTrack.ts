import { useState, useEffect } from 'react';
import { Track, Event, ActiveTrackChangedEvent } from '../types';
import { emitter } from '../EventEmitter';

/**
 * Module-level getter reference, populated by TrackPlayer via
 * _registerActiveTrackGetter() to avoid circular imports.
 */
let _getActiveTrack: () => Track | null = () => null;

/** True once TrackPlayer has registered the getter. */
let _isSetup = false;

/**
 * Called once during TrackPlayer initialization to wire up the active-track
 * getter. Not part of the public API.
 */
export function _registerActiveTrackGetter(getter: () => Track | null): void {
  _getActiveTrack = getter;
  _isSetup = true;
}

/**
 * Returns the currently active track, or `null` when the queue is empty or
 * stopped. Re-renders automatically whenever the active track changes.
 *
 * Initializes synchronously from the engine on mount so the component never
 * shows a stale null while a track is already loaded.
 *
 * @example
 * ```tsx
 * const track = useActiveTrack();
 * return <Text>{track?.title ?? 'Nothing playing'}</Text>;
 * ```
 */
export function useActiveTrack(): Track | null {
  const [track, setTrack] = useState<Track | null>(
    // Snapshot current track on mount if the getter is already registered.
    // Avoids a stale null flash when the hook mounts mid-playback.
    _isSetup ? _getActiveTrack() : null,
  );

  useEffect(() => {
    // Re-snapshot on mount in case the component mounted between the useState
    // initializer and this effect (edge case in concurrent rendering).
    if (_isSetup) {
      setTrack(_getActiveTrack());
    }

    const unsub = emitter.on(Event.PlaybackActiveTrackChanged, (payload) => {
      const { track: next } = payload as ActiveTrackChangedEvent;
      setTrack(next ?? null);
    });
    return unsub;
  }, []);

  return track;
}
