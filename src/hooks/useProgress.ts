import { useState, useEffect, useRef } from 'react';
import { Progress, State, Event, ActiveTrackChangedEvent } from '../types';
import { emitter } from '../EventEmitter';

/**
 * Drop-in replacement for RNTP's useProgress(updateInterval?).
 *
 * Polls position/duration from the engine on an interval.
 * Returns { position, duration, buffered } — all in seconds.
 *
 * `buffered` always equals `duration` because decodeAudioData loads the entire
 * file into memory before playback starts.
 *
 * The getters are registered by TrackPlayer.setupPlayer() via
 * _registerProgressGetters() to avoid circular imports.
 */

// Module-level getter references, populated by TrackPlayer
let _getPosition: () => number = () => 0;
let _getDuration: () => number = () => 0;
let _getState: () => State = () => State.None;

/**
 * True once TrackPlayer.setupPlayer() has called _registerProgressGetters().
 * Guards the mount snapshot in useProgress so we never read from the default
 * no-op stubs (which silently return 0 / State.None before setup completes).
 */
let _isSetup = false;

/**
 * Called once during TrackPlayer.setupPlayer() to wire up the engine getters.
 * Not part of the public API.
 */
export function _registerProgressGetters(
  getPosition: () => number,
  getDuration: () => number,
  getState: () => State,
): void {
  _getPosition = getPosition;
  _getDuration = getDuration;
  _getState = getState;
  _isSetup = true;
}

export function useProgress(updateInterval = 1000): Progress {
  const [progress, setProgress] = useState<Progress>({
    position: 0,
    duration: 0,
    buffered: 0,
  });

  // Only poll while the engine is actively playing — position doesn't change
  // when paused or stopped, so there is nothing useful to update.
  const isActiveRef = useRef(false);

  // Seed isActiveRef and snapshot current progress on mount. This handles the
  // case where the component mounts while a track is already playing (e.g. the
  // miniplayer appearing mid-playback after navigation).
  // Guard: skip the read entirely if setupPlayer() hasn't been called yet —
  // the default stubs return 0 / State.None and would produce a misleading
  // initial snapshot.
  useEffect(() => {
    if (!_isSetup) return;
    const state = _getState();
    if (state === State.Playing) {
      isActiveRef.current = true;
      const position = _getPosition();
      const duration = _getDuration();
      setProgress({ position, duration, buffered: duration });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the playback-state event to keep isActiveRef in sync with ongoing
  // state changes (play, pause, stop, etc.) after mount.
  useEffect(() => {
    const unsub = emitter.on(Event.PlaybackState, (payload) => {
      const { state } = payload as { state: State };
      isActiveRef.current = state === State.Playing;
    });
    return unsub;
  }, []);

  // When the active track changes, snapshot its duration immediately from the
  // track metadata rather than waiting for the next interval tick. This ensures
  // the miniplayer shows the correct duration as soon as a new track starts.
  useEffect(() => {
    const unsub = emitter.on(Event.PlaybackActiveTrackChanged, (payload) => {
      const { track } = payload as ActiveTrackChangedEvent;
      if (track) {
        // Prefer metadata duration (available immediately); fall back to the
        // engine's decoded duration for tracks without metadata.
        const duration = track.duration ?? _getDuration();
        setProgress({ position: 0, duration, buffered: duration });
        // The track change always accompanies the start of playback, so mark
        // the ref active so the interval begins ticking straight away.
        isActiveRef.current = true;
      } else {
        // track is null — queue was cleared or stopped
        setProgress({ position: 0, duration: 0, buffered: 0 });
        isActiveRef.current = false;
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      // Skip the update entirely when not playing — avoids a re-render every
      // second while the player is idle, paused, or stopped.
      if (!isActiveRef.current) return;

      const position = _getPosition();
      const duration = _getDuration();

      // Use the functional form of setState and return the previous reference
      // unchanged when the values haven't moved. This eliminates re-renders when
      // the engine reports the same position twice in a row (e.g. end of track).
      setProgress(prev =>
        prev.position === position && prev.duration === duration
          ? prev
          : { position, duration, buffered: duration }
      );
    }, updateInterval);

    return () => clearInterval(id);
  }, [updateInterval]);

  return progress;
}
