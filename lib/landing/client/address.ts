/**
 * Runs in the head, before first paint: marks that script is available, names the part the
 * address opens at (the head row reads it) and selects the client it names, so neither flashes
 * the wrong thing. Without script nothing is hidden.
 */
export const openAtAddress = (
  partIds: readonly string[],
  clientAnchors: readonly string[],
): void => {
  const root = document.documentElement;
  const hash = location.hash.slice(1);
  const part = partIds.find((id) => hash === id || hash.startsWith(`${id}-`));

  root.classList.add('js');
  root.dataset.part = part ?? partIds[0] ?? '';
  root.dataset.client = clientAnchors.includes(hash)
    ? hash
    : (clientAnchors[0] ?? '');
};
