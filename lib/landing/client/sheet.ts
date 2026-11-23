/**
 * Which part is in view: data-part on <html> (the head row reads it; addressFollowsPart names it
 * in the address) and the mark in the part strip.
 */
export const partTracking = (): void => {
  const root = document.documentElement;
  const sheets = [...document.querySelectorAll<HTMLElement>('.sheet')];

  const partLinks = [
    ...document.querySelectorAll<HTMLAnchorElement>('[data-part-link]'),
  ];

  // the sticky row the parts pass under: the head row on the spread, the part strip in the single
  // column (the other one is not displayed)
  const stickyRows = [
    ...document.querySelectorAll<HTMLElement>('.sheet-head, .bar'),
  ];

  const state = { current: '', frame: 0 };

  const follow = (): void => {
    // a part becomes current when the rule above it has gone under the sticky row
    const line = Math.max(...stickyRows.map((row) => row.offsetHeight)) + 2;

    const here =
      sheets.findLast((sheet) => sheet.getBoundingClientRect().top <= line) ??
      sheets.at(0);

    state.frame = 0;

    if (here !== undefined && here.id !== state.current) {
      state.current = here.id;
      root.dataset.part = here.id;

      for (const link of partLinks) {
        if (link.dataset.partLink === here.id) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      }
    }
  };

  const onScroll = (): void => {
    if (state.frame === 0) {
      state.frame = requestAnimationFrame(follow);
    }
  };

  globalThis.addEventListener('scroll', onScroll, { passive: true });
  globalThis.addEventListener('resize', onScroll);
  follow();
};

/**
 * The tool categories: an address or a link that names one opens it and folds the others, so it
 * is the row under the head. A link then scrolls there as to any anchor.
 */
export const toolGroups = (): void => {
  const groups = [
    ...document.querySelectorAll<HTMLDetailsElement>('.tool-group'),
  ];

  const groupAt = (hash: string): HTMLDetailsElement | undefined =>
    groups.find((group) => `#${group.id}` === hash);

  // false when the group is already the only one open, so there is nothing to move to
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

  document.addEventListener('click', (event) => {
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href^="#"]')
        : null;

    const group = link ? groupAt(link.hash) : undefined;

    if (group) {
      show(group);
    }
  });

  globalThis.addEventListener('hashchange', () => {
    open('auto');
  });

  open('instant');
};
