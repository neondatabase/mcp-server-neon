/** Keep nested client and tool links while their part is current. */
export const syncPartAddress = (
  part: string,
  firstPart: string | undefined,
  atCover: boolean,
): void => {
  const { hash, pathname, search } = location;

  // On mobile, the cover is above the first part and has no fragment.
  if (atCover) {
    if (hash !== '') {
      history.replaceState(history.state, '', pathname + search);
    }

    return;
  }

  const addressed =
    hash === ''
      ? firstPart
      : document
          .querySelector(`#${CSS.escape(hash.slice(1))}`)
          ?.closest('.sheet')?.id;

  if (part !== '' && addressed !== part) {
    history.replaceState(history.state, '', `#${part}`);
  }
};

type ScrollState = { part: string; timer?: ReturnType<typeof setTimeout> };

/** Keep the sticky navigation and the shareable URL in sync with document scroll. */
export const partTracking = (syncAddress: typeof syncPartAddress): void => {
  const root = document.documentElement;
  const sheets = [...document.querySelectorAll<HTMLElement>('.sheet')];
  const partStrip = document.querySelector<HTMLElement>('.bar');
  const partLinks = partStrip?.querySelectorAll<HTMLAnchorElement>('a') ?? [];
  const head = document.querySelector<HTMLElement>('.sheet-head');
  const state: ScrollState = { part: '' };

  const follow = (): void => {
    const line =
      Math.max(partStrip?.offsetHeight ?? 0, head?.offsetHeight ?? 0) + 2;

    const here =
      sheets.findLast((sheet) => sheet.getBoundingClientRect().top <= line) ??
      sheets.at(0);

    if (here !== undefined && here.id !== state.part) {
      state.part = here.id;
      root.dataset.part = here.id;

      for (const link of partLinks) {
        link.setAttribute(
          'aria-current',
          link.hash === `#${here.id}` ? 'location' : 'false',
        );
      }
    }
  };

  globalThis.addEventListener(
    'scroll',
    () => {
      follow();
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        const atCover = scrollY === 0 && (partStrip?.offsetHeight ?? 0) > 0;
        syncAddress(state.part, sheets.at(0)?.id, atCover);
      }, 150);
    },
    { passive: true },
  );
  globalThis.addEventListener('resize', follow);
  follow();
};

/** An address names one category. Open it before the browser scrolls to its link. */
export const toolGroups = (): void => {
  const groups = [
    ...document.querySelectorAll<HTMLDetailsElement>('.tool-group'),
  ];

  const groupAt = (hash: string): HTMLDetailsElement | undefined =>
    groups.find((group) => `#${group.id}` === hash);

  const show = (group: HTMLDetailsElement): boolean => {
    const changed = groups.some((other) => other.open !== (other === group));

    for (const other of groups) {
      other.open = other === group;
    }

    return changed;
  };

  const open = (behavior: ScrollBehavior): void => {
    const group = groupAt(location.hash);

    if (group && show(group)) {
      group.scrollIntoView({ behavior });
    }
  };

  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href^="#tools-"]',
  )) {
    link.addEventListener('click', (event) => {
      const group = groupAt(link.hash);

      const modified =
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

      if (group && !event.defaultPrevented && event.button === 0 && !modified) {
        show(group);
      }
    });
  }

  globalThis.addEventListener('hashchange', () => {
    open('auto');
  });

  open('instant');
};
