import { Howl, Howler } from 'howler';

interface InternalHowler {
  _canPlayEvent?: string;
}

export type HtmlAudioOptions = ConstructorParameters<typeof Howl>[0];

/**
 * Owns the one HTML5/Howler playback lane used by Marea.
 *
 * Howler is retained here because the existing provider needs its cross-browser
 * HTML5 streaming, unlock, and media-event behavior. Keeping construction and
 * disposal behind this singleton prevents a React remount, theme change, or
 * queue transition from leaving a second audio element alive in the document.
 * The provider may stage one candidate, but the engine never exposes more than
 * one active handle and always unloads the previous handle before construction.
 */
export class HtmlAudioEngine {
  private active: Howl | null = null;
  private pending: Howl | null = null;
  private readonly liveCanPlayEvents = new WeakMap<Howl, string | undefined>();

  create(options: HtmlAudioOptions, isLive: boolean): Howl {
    this.release(this.pending);
    this.release(this.active);

    const handle = this.createHowl(options, isLive);
    this.pending = handle;
    return handle;
  }

  adopt(handle: Howl): boolean {
    if (this.pending !== handle) return false;
    this.pending = null;
    this.active = handle;
    return true;
  }

  release(handle: Howl | null | undefined): void {
    if (!handle) return;
    this.restoreLiveCanPlayEvent(handle);
    handle.unload();
    if (this.active === handle) this.active = null;
    if (this.pending === handle) this.pending = null;
  }

  releaseAll(): void {
    const pending = this.pending;
    const active = this.active;
    this.pending = null;
    this.active = null;
    if (pending && pending !== active) this.release(pending);
    if (active) this.release(active);
  }

  getActive(): Howl | null {
    return this.active;
  }

  getPending(): Howl | null {
    return this.pending;
  }

  private createHowl(options: HtmlAudioOptions, isLive: boolean): Howl {
    if (!isLive) return new Howl(options);

    // Continuous streams may never emit canplaythrough. Howler uses its
    // current global event name when it later removes the listener, so this
    // must remain set until its synchronous load handler has finished.
    const internalHowler = Howler as unknown as InternalHowler;
    const previousCanPlayEvent = internalHowler._canPlayEvent;
    internalHowler._canPlayEvent = 'canplay';
    try {
      const handle = new Howl({ ...options, preload: 'metadata' });
      this.liveCanPlayEvents.set(handle, previousCanPlayEvent);
      handle.once('load', () => {
        queueMicrotask(() => this.restoreLiveCanPlayEvent(handle));
      });
      handle.once('loaderror', () => this.restoreLiveCanPlayEvent(handle));
      return handle;
    } catch (error) {
      internalHowler._canPlayEvent = previousCanPlayEvent;
      throw error;
    }
  }

  private restoreLiveCanPlayEvent(handle: Howl): void {
    if (!this.liveCanPlayEvents.has(handle)) return;
    const previousCanPlayEvent = this.liveCanPlayEvents.get(handle);
    this.liveCanPlayEvents.delete(handle);
    (Howler as unknown as InternalHowler)._canPlayEvent = previousCanPlayEvent;
  }
}

export const htmlAudioEngine = new HtmlAudioEngine();
