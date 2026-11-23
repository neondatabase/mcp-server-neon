/**
 * Runs in the head, before first paint: marks that script is available, names the part the
 * address opens at (the head row reads it) and selects the client it names, so neither flashes
 * the wrong thing. Without script nothing is hidden.
 */
export const openAtAddress = (
  partIds: readonly string[],
  clientAnchors: readonly (readonly [anchor: string, id: string])[],
): void => {
  const root = document.documentElement;
  const hash = location.hash.slice(1);
  const part = partIds.find((id) => hash === id || hash.startsWith(`${id}-`));
  const client = clientAnchors.find(([anchor]) => anchor === hash);

  root.classList.add('js');
  root.dataset.part = part ?? partIds[0] ?? '';
  root.dataset.client = (client ?? clientAnchors[0])?.[1] ?? '';
};

/**
 * Once scrolling rests, the address names the part in view (data-part, set by partTracking); a
 * finer address inside that part is kept. History gets no entry.
 */
export const addressFollowsPart = (): void => {
  const root = document.documentElement;
  const timer = { settled: setTimeout(() => undefined, 0) };

  const sync = (): void => {
    const part = root.dataset.part ?? '';
    const { hash } = location;

    // the part the address belongs to; no hash is the top of the document, which is the first part
    const addressed =
      hash === ''
        ? document.querySelector('.sheet')
        : document
            .querySelector(`[id="${CSS.escape(hash.slice(1))}"]`)
            ?.closest('.sheet');

    if (part !== '' && addressed?.id !== part) {
      history.replaceState(history.state, '', `#${part}`);
    }
  };

  globalThis.addEventListener(
    'scroll',
    () => {
      clearTimeout(timer.settled);
      timer.settled = setTimeout(sync, 150);
    },
    { passive: true },
  );
};
