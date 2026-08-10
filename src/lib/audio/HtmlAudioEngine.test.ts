import { describe, expect, it, vi } from 'vitest';

class FakeHowl {
  static instances: FakeHowl[] = [];
  readonly options: Record<string, unknown>;
  readonly unloaded = vi.fn();
  private readonly onceListeners = new Map<string, () => void>();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeHowl.instances.push(this);
  }

  unload(): void {
    this.unloaded();
  }

  once(event: string, listener: () => void): this {
    this.onceListeners.set(event, listener);
    return this;
  }

  fire(event: string): void {
    const listener = this.onceListeners.get(event);
    this.onceListeners.delete(event);
    listener?.();
  }
}

const fakeHowler = { _canPlayEvent: 'canplaythrough' };

vi.mock('howler', () => ({ Howl: FakeHowl, Howler: fakeHowler }));

const { HtmlAudioEngine } = await import('./HtmlAudioEngine');

describe('HtmlAudioEngine', () => {
  it('releases the previous lane before creating another handle', () => {
    const engine = new HtmlAudioEngine();
    const first = engine.create({ src: ['first.mp3'] }, false);
    engine.adopt(first);
    const second = engine.create({ src: ['second.mp3'] }, false);

    expect((first as unknown as FakeHowl).unloaded).toHaveBeenCalledOnce();
    expect(engine.getActive()).toBeNull();
    expect(engine.getPending()).toBe(second);
  });

  it('keeps the live canplay override through Howler load cleanup, then restores it', async () => {
    const engine = new HtmlAudioEngine();
    const live = engine.create({ src: ['radio.mp3'] }, true);

    expect((live as unknown as FakeHowl).options.preload).toBe('metadata');
    expect((live as unknown as FakeHowl).options.onload).toBeUndefined();
    expect(fakeHowler._canPlayEvent).toBe('canplay');
    expect(engine.adopt(live)).toBe(true);
    expect(engine.getActive()).toBe(live);
    expect(engine.adopt(new FakeHowl({ src: ['stale.mp3'] }) as never)).toBe(false);

    (live as unknown as FakeHowl).fire('load');
    await Promise.resolve();
    expect(fakeHowler._canPlayEvent).toBe('canplaythrough');
  });

  it('restores the live canplay override when a pending stream is released before it loads', () => {
    const engine = new HtmlAudioEngine();
    const live = engine.create({ src: ['radio.mp3'] }, true);

    engine.release(live);

    expect(fakeHowler._canPlayEvent).toBe('canplaythrough');
    expect((live as unknown as FakeHowl).unloaded).toHaveBeenCalledOnce();
  });
});
