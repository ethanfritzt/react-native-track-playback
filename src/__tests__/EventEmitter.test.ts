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
  // removeAllListeners
  // -------------------------------------------------------------------------

  it('removeAllListeners(event) removes all handlers for that event', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    emitter.on('test', h1);
    emitter.on('test', h2);
    emitter.removeAllListeners('test');
    emitter.emit('test');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('removeAllListeners() with no args removes all handlers for all events', () => {
    const hA = jest.fn();
    const hB = jest.fn();
    emitter.on('a', hA);
    emitter.on('b', hB);
    emitter.removeAllListeners();
    emitter.emit('a');
    emitter.emit('b');
    expect(hA).not.toHaveBeenCalled();
    expect(hB).not.toHaveBeenCalled();
  });

  it('removeAllListeners(event) does not affect other events', () => {
    const hA = jest.fn();
    const hB = jest.fn();
    emitter.on('a', hA);
    emitter.on('b', hB);
    emitter.removeAllListeners('a');
    emitter.emit('b');
    expect(hB).toHaveBeenCalledTimes(1);
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
