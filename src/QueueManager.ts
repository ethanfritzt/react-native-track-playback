import { Track, TrackMetadata } from './types';

/**
 * Pure-JS queue manager. No audio dependencies — fully synchronous and
 * unit-testable in isolation.
 */
export class QueueManager {
  private queue: Track[] = [];
  private currentIndex: number = -1;

  // ---------------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------------

  /** Replace the entire queue. Resets current index to 0. */
  setQueue(tracks: Track[]): void {
    this.queue = [...tracks];
    this.currentIndex = tracks.length > 0 ? 0 : -1;
  }

  /** Append tracks. If queue was empty, sets current index to 0. */
  add(tracks: Track[]): void {
    this.queue.push(...tracks);
    if (this.currentIndex === -1 && this.queue.length > 0) {
      this.currentIndex = 0;
    }
  }

  /**
   * Remove tracks by index or Track object (single or array).
   * When Track objects are passed, they are resolved to indices by URL.
   * Adjusts currentIndex after removal — if the current track was removed,
   * clamps to the new last index.
   */
  remove(indexOrIndices: number | number[] | Track | Track[]): void {
    // Resolve any Track objects to their queue indices
    const resolved = (Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices]).map(
      (item): number => {
        if (typeof item === 'number') return item;
        // Track object — find by URL
        const idx = this.queue.findIndex(t => t.url === item.url);
        return idx; // -1 if not found; will be filtered below
      }
    ).filter(i => i >= 0);

    const indices = new Set(resolved);

    const removingCurrent = indices.has(this.currentIndex);
    const removedBefore = [...indices].filter(i => i < this.currentIndex).length;

    this.queue = this.queue.filter((_, i) => !indices.has(i));

    if (this.queue.length === 0) {
      this.currentIndex = -1;
    } else if (removingCurrent) {
      // Land on the track that slid into the current slot, or clamp to last
      this.currentIndex = Math.min(
        this.currentIndex - removedBefore,
        this.queue.length - 1
      );
    } else {
      this.currentIndex -= removedBefore;
    }
  }

  /**
   * Merge metadata fields into the track at the given index in-place.
   * `url` is intentionally excluded — changing the URL would require
   * stopping and re-loading audio, which is the caller's responsibility.
   * Returns true if the index was valid, false otherwise.
   */
  updateTrack(index: number, patch: TrackMetadata): boolean {
    if (index < 0 || index >= this.queue.length) return false;
    // Object.assign mutates in-place — no new array allocation needed
    Object.assign(this.queue[index]!, patch);
    return true;
  }

  /** Clear queue and reset state. */
  reset(): void {
    this.queue = [];
    this.currentIndex = -1;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Advance to next track. Returns false if already at the end. */
  skipToNext(): boolean {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      return true;
    }
    return false;
  }

  /**
   * Go to previous track. Returns false if already at the start.
   * Note: TrackPlayer.skipToPrevious() handles the "restart if >3s" logic
   * itself before calling this — QueueManager is only responsible for index.
   */
  skipToPrevious(): boolean {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getQueue(): readonly Track[] {
    return this.queue;
  }

  getTrack(index: number): Track | undefined {
    return this.queue[index];
  }

  getActiveTrack(): Track | undefined {
    return this.currentIndex >= 0 ? this.queue[this.currentIndex] : undefined;
  }

  getActiveIndex(): number {
    return this.currentIndex;
  }

}
