import { EventEmitter } from '../EventEmitter';

describe('EventEmitter', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  // -------------------------------------------------------------------------
  // on / emit
  // -------------------------------------------------------------------------

  it('calls registered handler when the event is emitted', () => {
    const handler = jest.fn();
    emitter.on('test', handler);
    emitter.emit('test', 'arg1', 42);
    expect(handler).toHaveBeenCalledWith('arg1', 42);
  });

  it('calls multiple handlers registered to the same event', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    emitter.on('test', h1);
    emitter.on('test', h2);
    emitter.emit('test');
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('does not call handlers for different events', () => {
    const handler = jest.fn();
    emitter.on('event-a', handler);
    emitter.emit('event-b');
    expect(handler).not.toHaveBeenCalled();
  });

  it('emitting an event with no handlers does not throw', () => {
    expect(() => emitter.emit('no-listeners')).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // off / unsubscribe
  // -------------------------------------------------------------------------

  it('removes a handler via off()', () => {
    const handler = jest.fn();
    emitter.on('test', handler);
    emitter.off('test', handler);
    emitter.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes a handler via the returned unsubscribe function', () => {
    const handler = jest.fn();
    const unsub = emitter.on('test', handler);
    unsub();
    emitter.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('only removes the specified handler, leaving others intact', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    emitter.on('test', h1);
    emitter.on('test', h2);
    emitter.off('test', h1);
    emitter.emit('test');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('registering the same handler twice emits to it twice', () => {
    const handler = jest.fn();
    // Set-based: adding the same reference twice is deduplicated
    emitter.on('test', handler);
    emitter.on('test', handler);
    emitter.emit('test');
    // The internal Set deduplicates identical references
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('calling off for a handler that was never registered does not throw', () => {
    const handler = jest.fn();
    expect(() => emitter.off('test', handler)).not.toThrow();
  });
});


  // -------------------------------------------------------------------------
  // Edge cases (issue #5 additions)
  // -------------------------------------------------------------------------

  it('removing a listener twice does not throw', () => {
    const handler = jest.fn();
    emitter.on('test', handler);
    emitter.off('test', handler);
    // Second removal — should be silent
    expect(() => emitter.off('test', handler)).not.toThrow();
  });

  it('adding a listener during event dispatch does not affect the current dispatch cycle', () => {
    const order: string[] = [];

    emitter.on('test', () => {
      order.push('first');
      // Register a new listener mid-dispatch
      emitter.on('test', () => order.push('late'));
    });

    emitter.emit('test');
    // 'late' was registered inside the dispatch — should NOT have fired yet
    expect(order).toEqual(['first']);

    // On the next emit, the late listener fires
    emitter.emit('test');
    expect(order).toContain('late');
  });

  it('all Event enum values are emittable without throwing', () => {
    const { Event } = require('../types');
    const eventValues: string[] = Object.values(Event);
    expect(eventValues.length).toBeGreaterThan(0);
    for (const eventName of eventValues) {
      expect(() => emitter.emit(eventName, {})).not.toThrow();
    }
  });

  it('PlaybackError payload has message and code fields', () => {
    const { Event } = require('../types');
    const received: any[] = [];
    const unsub = emitter.on(Event.PlaybackError, (payload: any) => received.push(payload));

    emitter.emit(Event.PlaybackError, { message: 'stream failed', code: -1 });

    expect(received[0]).toMatchObject({ message: expect.any(String), code: expect.any(Number) });
    unsub();
  });

  it('PlaybackActiveTrackChanged payload has track and index fields', () => {
    const { Event } = require('../types');
    const received: any[] = [];
    const unsub = emitter.on(Event.PlaybackActiveTrackChanged, (payload: any) => received.push(payload));

    emitter.emit(Event.PlaybackActiveTrackChanged, {
      track: { url: 'http://example.com/t.mp3', title: 'Track 1' },
      index: 0,
      lastTrack: null,
      lastIndex: -1,
    });

    expect(received[0]).toMatchObject({
      track: expect.objectContaining({ url: expect.any(String) }),
      index: expect.any(Number),
    });
    unsub();
  });
});
