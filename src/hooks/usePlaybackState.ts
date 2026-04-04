import { useState, useEffect } from 'react';
import { State, Event } from '../types';
import { emitter } from '../EventEmitter';

// Module-level getter, registered by TrackPlayer at import time.
// Allows the hook to read current state synchronously on mount.
let _getState: (() => State) | null = null;
let _isRegistered = false;

/**
 * Called by TrackPlayer.ts at module level to wire up the state getter.
 * Not part of the public API.
 */
export function _registerStateGetter(fn: () => State): void {
  _getState = fn;
  _isRegistered = true;
}

/**
 * Returns `{ state: State | undefined }`.
 *
 * Initializes synchronously from the current engine state on mount —
 * so components mounting mid-playback get the correct state immediately
 * rather than waiting for the next PlaybackState event.
 */
export function usePlaybackState(): { state: State | undefined } {
  const [state, setState] = useState<State | undefined>(() =>
    _isRegistered ? _getState!() : undefined
  );

  useEffect(() => {
    const unsub = emitter.on(Event.PlaybackState, (payload) => {
      setState((payload as { state: State }).state);
    });
    return unsub;
  }, []);

  return { state };
}
