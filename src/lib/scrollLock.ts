/**
 * Reference-counted lock on background scrolling.
 *
 * Each caller used to save and restore `document.body.style.overflow` itself,
 * which is only correct while exactly one of them is open. With two — a dialog
 * opened from a menu that had also locked — the inner one restores on close and
 * the page starts scrolling again underneath the outer one still on screen.
 * Counting means the style is only restored by the last release, and the
 * original value is captured once by the first acquire.
 */
let depth = 0;
let restoreTo = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (depth === 0) {
    restoreTo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  depth += 1;

  let released = false;
  return () => {
    // Guarded so a double release cannot unlock while another holder remains.
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) document.body.style.overflow = restoreTo;
  };
}

/** Test seam: the counter is module state and does not reset between cases. */
export function resetBodyScrollLock(): void {
  depth = 0;
  restoreTo = '';
  if (typeof document !== 'undefined') document.body.style.overflow = '';
}
