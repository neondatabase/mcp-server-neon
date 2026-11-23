/** The client selector is a row of links until script makes it a tab list, each tab owning its panel. */
export const tabRoles = (): void => {
  const tablist = document.querySelector('[data-clients]');

  tablist?.setAttribute('role', 'tablist');

  for (const tab of document.querySelectorAll<HTMLAnchorElement>(
    '[data-client-link]',
  )) {
    const panel = document.querySelector(
      `[id="${CSS.escape(tab.hash.slice(1))}"]`,
    );

    tab.setAttribute('role', 'tab');
    tab.id = `tab-${tab.dataset.clientLink ?? ''}`;
    tab.setAttribute('aria-controls', tab.hash.slice(1));
    panel?.setAttribute('role', 'tabpanel');
    panel?.setAttribute('aria-labelledby', tab.id);
  }
};

/**
 * A press on a tab changes the procedure in place; the page does not move and history gets no
 * entry.
 */
export const clientTabs = (): void => {
  const root = document.documentElement;
  const tablist = document.querySelector<HTMLElement>('[data-clients]');

  const tabs = [
    ...document.querySelectorAll<HTMLAnchorElement>('[data-client-link]'),
  ];

  const select = (id: string): void => {
    root.dataset.client = id;

    for (const tab of tabs) {
      const selected = tab.dataset.clientLink === id;

      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;

      // the strip scrolls sideways on a narrow page: bring the selected label into it
      if (selected && tablist) {
        const right = tab.offsetLeft + tab.offsetWidth - tablist.clientWidth;

        tablist.scrollLeft = Math.min(
          Math.max(tablist.scrollLeft, right),
          tab.offsetLeft,
        );
      }
    }
  };

  document.addEventListener('click', (event) => {
    const tab =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('[data-client-link]')
        : null;

    const modified =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

    if (tab && event.button === 0 && !modified && !event.defaultPrevented) {
      event.preventDefault();
      select(tab.dataset.clientLink ?? '');
      history.replaceState(history.state, '', tab.hash);
    }
  });

  select(root.dataset.client ?? '');
};

/**
 * The tab list's keys: arrows move to the next or previous client, Home and End to the first or
 * last, Space selects the focused one. Each move is a press on that tab (clientTabs).
 */
export const tabKeys = (): void => {
  const tabs = [
    ...document.querySelectorAll<HTMLAnchorElement>('[data-client-link]'),
  ];

  document.addEventListener('keydown', (event) => {
    const tab =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('[role="tab"]')
        : null;

    const modified =
      event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;

    if (!tab || modified || event.defaultPrevented) {
      return;
    }

    const index = tabs.indexOf(tab);

    const moves = new Map([
      ['ArrowRight', index + 1],
      ['ArrowDown', index + 1],
      ['ArrowLeft', index - 1],
      ['ArrowUp', index - 1],
      ['Home', 0],
      ['End', tabs.length - 1],
      [' ', index],
    ]);

    const next = moves.get(event.key);
    const other = next === undefined ? undefined : tabs.at(next % tabs.length);

    if (other) {
      event.preventDefault();
      other.click();
      other.focus();
    }
  });
};

/**
 * An address that names a client (on load or by a later hash change): its panel was hidden when
 * the browser looked for the anchor, so press its tab, then go there.
 */
export const clientAddress = (): void => {
  const tablist = document.querySelector('[data-clients]');

  const open = (behavior: ScrollBehavior): void => {
    const panel = document.querySelector<HTMLElement>(
      `.client[id="${CSS.escape(location.hash.slice(1))}"]`,
    );

    const tab = panel
      ? tablist?.querySelector<HTMLElement>(`[href="#${CSS.escape(panel.id)}"]`)
      : null;

    if (panel && tab) {
      tab.click();
      panel.scrollIntoView({ behavior });
    }
  };

  globalThis.addEventListener('hashchange', () => {
    open('auto');
  });

  open('instant');
};
