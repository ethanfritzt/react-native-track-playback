import { useState, useEffect, useRef } from 'react';
import { Progress } from '../types';
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

/**
 * Called once during TrackPlayer.setupPlayer() to wire up the engine getters.
 * Not part of the public API.
 */
export function _registerProgressGetters(
  getPosition: () => number,
  getDuration: () => number
): void {
  _getPosition = getPosition;
  _getDuration = getDuration;
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

  useEffect(() => {
    const unsub = emitter.on('playback-state', (payload) => {
      const { state } = payload as { state: string };
      isActiveRef.current = state === 'playing';
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
