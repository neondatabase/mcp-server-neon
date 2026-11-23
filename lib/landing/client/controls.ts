/**
 * The copy buttons: a press copies data-copy and shows the check for two seconds, the button's
 * name saying "Copied" meanwhile. The clipboard exists only on a secure origin; elsewhere the
 * text is still selectable.
 */
export const copyButtons = (): void => {
  const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  const showCopied = (button: HTMLElement): void => {
    // a second press within the two seconds keeps the name from before the first
    const name = timers.has(button)
      ? (button.dataset.name ?? '')
      : (button.getAttribute('aria-label') ?? '');

    button.dataset.name = name;
    button.classList.add('copied');
    button.setAttribute('aria-label', 'Copied');
    button.title = 'Copied';
    clearTimeout(timers.get(button));

    timers.set(
      button,
      setTimeout(() => {
        timers.delete(button);
        button.classList.remove('copied');
        button.setAttribute('aria-label', name);
        button.title = name;
      }, 2000),
    );
  };

  const copy = async (button: HTMLElement): Promise<void> => {
    await navigator.clipboard.writeText(button.dataset.copy ?? '');
    showCopied(button);
  };

  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.copy-btn')
        : null;

    if (button && 'clipboard' in navigator) {
      copy(button).catch(() => undefined);
    }
  });
};

/**
 * Anchors glide only once the page has opened (the class turns on smooth scrolling): the jump to
 * the address it opens at is not a journey.
 */
export const glideAfterLoad = (): void => {
  const root = document.documentElement;

  const glide = (): void => {
    setTimeout(() => {
      root.classList.add('ready');
    }, 0);
  };

  if (document.readyState === 'complete') {
    glide();
  } else {
    globalThis.addEventListener('load', glide);
  }
};
