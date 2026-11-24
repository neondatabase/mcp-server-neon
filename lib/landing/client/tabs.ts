export const enhanceTabs = (
  tablist: HTMLElement,
  tabs: readonly HTMLAnchorElement[],
  select: (tab: HTMLAnchorElement) => void,
): void => {
  tablist.setAttribute('role', 'tablist');

  for (const tab of tabs) {
    const id = tab.hash.slice(1);
    const panel = document.querySelector<HTMLElement>(tab.hash);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', id);

    if (panel) {
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
    }

    tab.addEventListener('click', (event) => {
      const modified =
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

      if (event.defaultPrevented || event.button !== 0 || modified) {
        return;
      }

      event.preventDefault();
      select(tab);
      history.replaceState(history.state, '', tab.hash);
    });
  }
};

export const tabKeys = (
  tablist: HTMLElement,
  tabs: readonly HTMLAnchorElement[],
): void => {
  tablist.addEventListener('keydown', (event) => {
    const { target } = event;

    const modified =
      event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;

    if (
      !(target instanceof HTMLAnchorElement) ||
      modified ||
      event.defaultPrevented
    ) {
      return;
    }

    const index = tabs.indexOf(target);

    if (index === -1) {
      return;
    }

    const moves = new Map([
      ['ArrowLeft', index - 1],
      ['ArrowRight', index + 1],
      ['Home', 0],
      ['End', tabs.length - 1],
      [' ', index],
    ]);

    const next = moves.get(event.key);

    if (next !== undefined) {
      event.preventDefault();
      const tab = tabs.at(next % tabs.length);
      tab?.click();
      tab?.focus({ preventScroll: true });
    }
  });
};

/** Enhance the client links as tabs, keeping their fragment URLs shareable. */
export const clientTabs = (
  enhance: typeof enhanceTabs,
  bindKeys: typeof tabKeys,
): void => {
  const root = document.documentElement;
  const tablist = document.querySelector<HTMLElement>('[data-clients]');

  if (!tablist) {
    return;
  }

  const tabs = [...tablist.querySelectorAll<HTMLAnchorElement>('.tab')];

  const select = (tab: HTMLAnchorElement): void => {
    root.dataset.client = tab.hash.slice(1);

    for (const link of tabs) {
      link.setAttribute('aria-selected', String(link === tab));
      link.tabIndex = link === tab ? 0 : -1;
    }

    // Reveal the selected label in an overflowing tab strip without moving the page.
    const { offsetLeft, offsetWidth } = tab;
    const right = offsetLeft + offsetWidth - tablist.clientWidth;
    tablist.scrollLeft = Math.min(
      Math.max(tablist.scrollLeft, right),
      offsetLeft,
    );
  };

  const openLinkedPanel = (behavior: ScrollBehavior): void => {
    const linked = tabs.find((tab) => tab.hash === location.hash);
    const active = linked ?? (behavior === 'instant' ? tabs.at(0) : undefined);

    if (active) {
      select(active);
    }

    if (linked) {
      document.querySelector(linked.hash)?.scrollIntoView({ behavior });
    }
  };

  enhance(tablist, tabs, select);
  bindKeys(tablist, tabs);
  globalThis.addEventListener('hashchange', () => {
    openLinkedPanel('auto');
  });
  openLinkedPanel('instant');
};
