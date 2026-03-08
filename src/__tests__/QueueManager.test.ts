import { QueueManager } from '../QueueManager';
import { Track } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function track(n: number): Track {
  return { url: `http://example.com/track${n}.mp3`, title: `Track ${n}` };
}

function makeQueue(...nums: number[]): QueueManager {
  const q = new QueueManager();
  q.setQueue(nums.map(track));
  return q;
}

// ---------------------------------------------------------------------------
// setQueue
// ---------------------------------------------------------------------------

describe('setQueue', () => {
  it('sets the queue and resets active index to 0', () => {
    const q = makeQueue(1, 2, 3);
    expect(q.getQueue()).toHaveLength(3);
    expect(q.getActiveIndex()).toBe(0);
    expect(q.getActiveTrack()?.url).toBe('http://example.com/track1.mp3');
  });

  it('sets active index to -1 for an empty queue', () => {
    const q = new QueueManager();
    q.setQueue([]);
    expect(q.getActiveIndex()).toBe(-1);
    expect(q.getActiveTrack()).toBeUndefined();
  });

  it('replaces an existing queue', () => {
    const q = makeQueue(1, 2, 3);
    q.setQueue([track(4), track(5)]);
    expect(q.getQueue()).toHaveLength(2);
    expect(q.getActiveTrack()?.url).toBe('http://example.com/track4.mp3');
  });
});

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

describe('add', () => {
  it('appends tracks to an existing queue', () => {
    const q = makeQueue(1, 2);
    q.add([track(3), track(4)]);
    expect(q.getQueue()).toHaveLength(4);
  });

  it('sets active index to 0 when adding to an empty queue', () => {
    const q = new QueueManager();
    q.add([track(1), track(2)]);
    expect(q.getActiveIndex()).toBe(0);
  });

  it('does not change active index when queue was already non-empty', () => {
    const q = makeQueue(1, 2);
    q.skipToNext(); // now at index 1
    q.add([track(3)]);
    expect(q.getActiveIndex()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('remove', () => {
  it('removes a single track by index', () => {
    const q = makeQueue(1, 2, 3);
    q.remove(1);
    expect(q.getQueue().map(t => t.title)).toEqual(['Track 1', 'Track 3']);
  });

  it('removes multiple tracks by index array', () => {
    const q = makeQueue(1, 2, 3, 4);
    q.remove([0, 2]);
    expect(q.getQueue().map(t => t.title)).toEqual(['Track 2', 'Track 4']);
  });

  it('removes a track by Track object (matched by URL)', () => {
    const q = makeQueue(1, 2, 3);
    q.remove(track(2));
    expect(q.getQueue().map(t => t.title)).toEqual(['Track 1', 'Track 3']);
  });

  it('adjusts active index down when a track before current is removed', () => {
    const q = makeQueue(1, 2, 3);
    q.skipToNext(); // index 1 (Track 2)
    q.remove(0);   // remove Track 1
    expect(q.getActiveIndex()).toBe(0);
    expect(q.getActiveTrack()?.title).toBe('Track 2');
  });

  it('clamps active index to last when the current track is removed', () => {
    const q = makeQueue(1, 2, 3);
    q.skipToNext();
    q.skipToNext(); // index 2 (Track 3)
    q.remove(2);
    expect(q.getActiveIndex()).toBe(1);
    expect(q.getActiveTrack()?.title).toBe('Track 2');
  });

  it('sets active index to -1 when the only track is removed', () => {
    const q = makeQueue(1);
    q.remove(0);
    expect(q.getActiveIndex()).toBe(-1);
    expect(q.getActiveTrack()).toBeUndefined();
  });

  it('silently ignores indices not found for Track objects', () => {
    const q = makeQueue(1, 2);
    q.remove(track(99)); // not in queue
    expect(q.getQueue()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('reset', () => {
  it('clears the queue and resets state', () => {
    const q = makeQueue(1, 2, 3);
    q.reset();
    expect(q.getQueue()).toHaveLength(0);
    expect(q.getActiveIndex()).toBe(-1);
    expect(q.getActiveTrack()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('skipToNext', () => {
  it('advances the index and returns true', () => {
    const q = makeQueue(1, 2, 3);
    expect(q.skipToNext()).toBe(true);
    expect(q.getActiveIndex()).toBe(1);
  });

  it('returns false and does not advance past the last track', () => {
    const q = makeQueue(1, 2);
    q.skipToNext(); // index 1
    expect(q.skipToNext()).toBe(false);
    expect(q.getActiveIndex()).toBe(1);
  });

  it('returns false on an empty queue', () => {
    const q = new QueueManager();
    expect(q.skipToNext()).toBe(false);
  });
});

describe('skipToPrevious', () => {
  it('moves back one track and returns true', () => {
    const q = makeQueue(1, 2, 3);
    q.skipToNext(); // index 1
    expect(q.skipToPrevious()).toBe(true);
    expect(q.getActiveIndex()).toBe(0);
  });

  it('returns false when already at the first track', () => {
    const q = makeQueue(1, 2);
    expect(q.skipToPrevious()).toBe(false);
    expect(q.getActiveIndex()).toBe(0);
  });
});

describe('skipToIndex', () => {
  it('jumps to a specific index', () => {
    const q = makeQueue(1, 2, 3, 4);
    q.skipToIndex(3);
    expect(q.getActiveIndex()).toBe(3);
    expect(q.getActiveTrack()?.title).toBe('Track 4');
  });

  it('ignores out-of-bounds indices', () => {
    const q = makeQueue(1, 2);
    q.skipToIndex(99);
    expect(q.getActiveIndex()).toBe(0); // unchanged
  });
});

// ---------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------

describe('shuffle', () => {
  it('keeps the current track at index 0', () => {
    const q = makeQueue(1, 2, 3, 4, 5);
    q.skipToIndex(2); // playing Track 3
    q.shuffle();
    expect(q.getActiveIndex()).toBe(0);
    expect(q.getActiveTrack()?.title).toBe('Track 3');
  });

  it('preserves all tracks after shuffle', () => {
    const q = makeQueue(1, 2, 3, 4, 5);
    q.shuffle();
    const titles = q.getQueue().map(t => t.title).sort();
    expect(titles).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5']);
  });

  it('is a no-op for a single-track queue', () => {
    const q = makeQueue(1);
    q.shuffle();
    expect(q.getActiveIndex()).toBe(0);
    expect(q.getQueue()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// hasNext / hasPrevious
// ---------------------------------------------------------------------------

describe('hasNext / hasPrevious', () => {
  it('hasNext is false at the end of the queue', () => {
    const q = makeQueue(1, 2);
    q.skipToNext();
    expect(q.hasNext()).toBe(false);
  });

  it('hasNext is true when not at the end', () => {
    const q = makeQueue(1, 2);
    expect(q.hasNext()).toBe(true);
  });

  it('hasPrevious is false at the start', () => {
    const q = makeQueue(1, 2);
    expect(q.hasPrevious()).toBe(false);
  });

  it('hasPrevious is true after skipping forward', () => {
    const q = makeQueue(1, 2);
    q.skipToNext();
    expect(q.hasPrevious()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTrack
// ---------------------------------------------------------------------------

describe('getTrack', () => {
  it('returns the track at the given index', () => {
    const q = makeQueue(1, 2, 3);
    expect(q.getTrack(1)?.title).toBe('Track 2');
  });

  it('returns undefined for out-of-bounds index', () => {
    const q = makeQueue(1);
    expect(q.getTrack(5)).toBeUndefined();
  });
});
