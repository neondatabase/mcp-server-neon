type CopyFeedback = { timer?: ReturnType<typeof setTimeout> };

/** Copy the rendered code, including any text inside syntax highlighting spans. */
export const copyButtons = (): void => {
  if (!('clipboard' in navigator)) {
    return;
  }

  const { clipboard } = navigator;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.copy-btn',
  )) {
    const code = button.parentElement?.querySelector('code');

    if (!code) {
      continue;
    }

    const label = button.title;
    const feedback: CopyFeedback = {};

    const setLabel = (name: string): void => {
      button.setAttribute('aria-label', name);
      button.title = name;
    };

    const showResult = (copied: boolean): void => {
      button.classList.toggle('copied', copied);
      setLabel(copied ? 'Copied' : 'Copy failed');
      clearTimeout(feedback.timer);
      feedback.timer = setTimeout(() => {
        button.classList.remove('copied');
        setLabel(label);
      }, 2000);
    };

    const copy = async (): Promise<void> => {
      await clipboard.writeText(code.textContent ?? '');
      showResult(true);
    };

    button.hidden = false;
    button.addEventListener('click', () => {
      copy().catch(() => {
        showResult(false);
      });
    });
  }
};

/** Enable smooth scrolling after the browser has jumped to the initial fragment. */
export const glideAfterLoad = (): void => {
  const { documentElement } = document;

  const glide = (): void => {
    setTimeout(() => {
      documentElement.classList.add('ready');
    }, 0);
  };

  if (document.readyState === 'complete') {
    glide();
  } else {
    globalThis.addEventListener('load', glide, { once: true });
  }
};
