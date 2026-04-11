import { useEffect, useState } from 'react';
import { emitter } from '../EventEmitter';
import { Event, Track } from '../types';

/**
 * Module-level getter reference, populated by TrackPlayer via
 * _registerQueueGetter() to avoid circular imports.
 */
let _getQueue: () => readonly Track[] = () => [];

/** True once TrackPlayer has registered the getter. */
let _isSetup = false;

/**
 * Called once during TrackPlayer initialization to wire up the queue getter.
 * Not part of the public API.
 */
export function _registerQueueGetter(getter: () => readonly Track[]): void {
  _getQueue = getter;
  _isSetup = true;
}

/**
 * Returns the current queue and re-renders automatically whenever queue
 * mutations occur.
 */
export function useQueue(): readonly Track[] {
  const [queue, setQueue] = useState<readonly Track[]>(() => (_isSetup ? _getQueue() : []));

  useEffect(() => {
    if (_isSetup) {
      setQueue(_getQueue());
    }

    const unsub = emitter.on(Event.QueueChanged, (payload) => {
      setQueue(payload as readonly Track[]);
    });

    return unsub;
  }, []);

  return queue;
}
