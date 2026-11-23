import { addressFollowsPart, openAtAddress } from './client/address';
import { copyButtons, glideAfterLoad } from './client/controls';
import { partTracking, toolGroups } from './client/sheet';
import { clientAddress, clientTabs, tabKeys, tabRoles } from './client/tabs';

/** The copy mark as Neon docs code blocks draw it; the check is neon.com's square-cornered 1px line. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect width="8.995" height="9.002" x="5.939" y="5.935" stroke="currentColor" rx="1"/><path fill="currentColor" fill-rule="evenodd" d="M2.434.935a1.5 1.5 0 0 0-1.5 1.5v7.001a1.5 1.5 0 0 0 1.5 1.5h1.499a.5.5 0 0 0 0-1h-1.5a.5.5 0 0 1-.5-.5V2.435a.5.5 0 0 1 .5-.5h6.995a.5.5 0 0 1 .5.5v1.5a.5.5 0 1 0 1 0v-1.5a1.5 1.5 0 0 0-1.5-1.5z" clip-rule="evenodd"/></svg>';

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6l4.286 5L13 2"/></svg>';

/** Both states of a copy button; CSS shows the check while it has `.copied`. */
export const COPY_ICONS = `<span class="copy-icon">${COPY_ICON}${CHECK_ICON}</span>`;

/** A value as JavaScript source inside a <script>: JSON, with `<` escaped so it cannot close the tag. */
const scriptValue = (
  value: readonly string[] | readonly (readonly [string, string])[],
): string => JSON.stringify(value).replaceAll('<', String.raw`\u003c`);

/** The head script (client/address.ts, openAtAddress) called with the page's part and client addresses. */
export const openAtAddressScript = (
  partIds: readonly string[],
  clientAnchors: readonly (readonly [anchor: string, id: string])[],
): string =>
  `(${String(openAtAddress)})(${scriptValue(partIds)},${scriptValue(clientAnchors)});`;

/**
 * The page script, run at the end of the body: each feature in client/ inlined by its own source
 * text and run on its own. They share only the DOM, so their order is the order they act on load:
 * the client and category the address names are opened before the part in view is read.
 */
export const INTERACTION_SCRIPT = [
  tabRoles,
  clientTabs,
  tabKeys,
  clientAddress,
  toolGroups,
  partTracking,
  addressFollowsPart,
  copyButtons,
  glideAfterLoad,
]
  .map((feature) => `(${String(feature)})();`)
  .join('\n');
