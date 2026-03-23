import { useState, useEffect } from 'react';
import { State, PlaybackState, Event } from '../types';
import { emitter } from '../EventEmitter';

/**
 * Drop-in replacement for RNTP's usePlaybackState().
 *
 * Returns `{ state: State | undefined }`.
 * `state` is undefined until the first playback state event fires (i.e. before
 * TrackPlayer.setupPlayer() is called), matching RNTP's initial behaviour.
 */
export function usePlaybackState(): { state: State | undefined } {
  const [state, setState] = useState<State | undefined>(undefined);

  useEffect(() => {
    const unsub = emitter.on(Event.PlaybackState, (payload) => {
      setState((payload as PlaybackState).state);
    });
    return unsub;
  }, []);

  return { state };
}
