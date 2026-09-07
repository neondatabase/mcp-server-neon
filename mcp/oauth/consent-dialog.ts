import he from 'he';
import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import { hasWriteScope, SCOPE_DEFINITIONS } from '../utils/read-only';
import { getFilteredTools } from '../tools/grant-filter';
import type { NeonTool } from '../tools/tool-definition';

const SCOPE_CATEGORY_LABELS: Record<ScopeCategory, string> = {
  projects: 'Projects',
  branches: 'Branches',
  endpoints: 'Endpoints',
  snapshots: 'Snapshots',
  schema: 'Schema',
  querying: 'Querying',
  neon_auth: 'Neon Auth',
  data_api: 'Data API',
  observability: 'Observability',
  docs: 'Docs',
  functions: 'Functions',
  storage: 'Storage',
};

const DISCOVERY_LABEL = 'Discovery';
const COLLAPSE_ABOVE = 12;

type ConsentTool = {
  name: string;
  title: string;
  scope: ScopeCategory | null;
};

type ConsentProject = { kind: 'all' } | { kind: 'one'; projectId: string };

type ConsentCategories =
  | { kind: 'all' }
  | { kind: 'subset'; labels: string[] }
  | { kind: 'none' };

type ConsentView = {
  writeChecked: boolean;
  project: ConsentProject;
  categories: ConsentCategories;
  unknownCategoryValues: string[];
  readTools: ConsentTool[];
  writeOnlyTools: ConsentTool[];
  readOnlyRequestedByConnection: boolean;
};

type ConsentClient = {
  client_name?: string;
  client_uri?: string;
  redirect_uris?: string[];
};

type ConsentDialogProps = {
  client: ConsentClient;
  state: string;
  requestedScopes: string[];
  defaultReadOnly: boolean;
  readOnlyRequestedByConnection: boolean;
  grant: GrantContext;
};

export function isWriteChecked({
  requestedScopes,
  defaultReadOnly,
}: {
  requestedScopes: string[];
  defaultReadOnly: boolean;
}): boolean {
  return (
    !defaultReadOnly &&
    (requestedScopes.length === 0 || hasWriteScope(requestedScopes))
  );
}

function toolLabel(tool: NeonTool): ConsentTool {
  const title = tool.annotations.title;
  return {
    name: tool.name,
    title: typeof title === 'string' && title.length > 0 ? title : tool.name,
    scope: tool.scope,
  };
}

function categoryLabels(scopes: ScopeCategory[]): string[] {
  return scopes.map((scope) => SCOPE_CATEGORY_LABELS[scope]);
}

export function buildConsentView({
  grant,
  requestedScopes,
  defaultReadOnly,
  readOnlyRequestedByConnection,
}: {
  grant: GrantContext;
  requestedScopes: string[];
  defaultReadOnly: boolean;
  readOnlyRequestedByConnection: boolean;
}): ConsentView {
  const writeChecked = isWriteChecked({
    requestedScopes,
    defaultReadOnly,
  });
  const readTools = getFilteredTools(grant, true).map(toolLabel);
  const writeTools = getFilteredTools(grant, false).map(toolLabel);
  const readNames = new Set(readTools.map((tool) => tool.name));
  const writeOnlyTools = writeTools.filter((tool) => !readNames.has(tool.name));

  const project: ConsentProject = grant.projectId
    ? { kind: 'one', projectId: grant.projectId }
    : { kind: 'all' };

  let categories: ConsentCategories;
  if (grant.scopes === null) {
    categories = { kind: 'all' };
  } else if (grant.scopes.length === 0) {
    categories = { kind: 'none' };
  } else {
    categories = { kind: 'subset', labels: categoryLabels(grant.scopes) };
  }

  return {
    writeChecked,
    project,
    categories,
    unknownCategoryValues: grant.unknownCategories ?? [],
    readTools,
    writeOnlyTools,
    readOnlyRequestedByConnection,
  };
}

function categoryLabelForTool(tool: ConsentTool): string {
  return tool.scope ? SCOPE_CATEGORY_LABELS[tool.scope] : DISCOVERY_LABEL;
}

function groupToolsByCategory<T extends ConsentTool>(
  tools: T[],
): { label: string; tools: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const tool of tools) {
    const label = categoryLabelForTool(tool);
    const existing = buckets.get(label);
    if (existing) {
      existing.push(tool);
    } else {
      buckets.set(label, [tool]);
    }
  }

  const order = [
    DISCOVERY_LABEL,
    ...SCOPE_CATEGORIES.map((id) => SCOPE_CATEGORY_LABELS[id]),
  ];
  return order.flatMap((label) => {
    const grouped = buckets.get(label);
    return grouped ? [{ label, tools: grouped }] : [];
  });
}

function renderToolGroupList(
  tools: Array<ConsentTool & { writeOnly: boolean }>,
  writeChecked: boolean,
): string {
  if (tools.length === 0) {
    return `<p class="empty-tools">None.</p>`;
  }
  return groupToolsByCategory(tools)
    .map((group) => {
      const groupHidden =
        !writeChecked && group.tools.every((tool) => tool.writeOnly)
          ? ' hidden'
          : '';
      return `
        <div class="tool-group"${groupHidden}>
          <div class="tool-group-label">${he.escape(group.label)}</div>
          <ul class="tool-list">${group.tools
            .map((tool) => {
              const writeAttr = tool.writeOnly ? ' data-write-tool' : '';
              const hiddenAttr =
                tool.writeOnly && !writeChecked ? ' hidden' : '';
              const badge = tool.writeOnly
                ? ' <span class="write-badge">write</span>'
                : '';
              return `<li${writeAttr}${hiddenAttr}>${he.escape(tool.title)}${badge}</li>`;
            })
            .join('')}</ul>
        </div>`;
    })
    .join('');
}

function toolsSummary(view: ConsentView): string {
  const count = view.writeChecked
    ? view.readTools.length + view.writeOnlyTools.length
    : view.readTools.length;
  const listed = view.writeChecked
    ? [...view.readTools, ...view.writeOnlyTools]
    : view.readTools;
  const categories = new Set(listed.map(categoryLabelForTool)).size;
  const categoryWord = categories === 1 ? 'category' : 'categories';
  const mode = view.writeChecked ? 'read and write' : 'read-only';
  return `Tools · ${String(count)} in ${String(categories)} ${categoryWord} · ${mode}`;
}

function renderToolSections(view: ConsentView): string {
  const tools: Array<ConsentTool & { writeOnly: boolean }> = [
    ...view.readTools.map((tool) => ({ ...tool, writeOnly: false })),
    ...view.writeOnlyTools.map((tool) => ({ ...tool, writeOnly: true })),
  ];
  if (tools.length === 0) {
    return '';
  }
  const collapse = tools.length > COLLAPSE_ABOVE;
  const body = renderToolGroupList(tools, view.writeChecked);
  const summary = toolsSummary(view);
  if (!collapse) {
    return `
      <section class="panel">
        <h2>Available tools</h2>
        <div class="tool-block" data-tools>
          <div class="tool-block-title" data-tools-summary>${he.escape(summary)}</div>
          ${body}
        </div>
      </section>`;
  }
  return `
    <section class="panel">
      <h2>Available tools</h2>
      <details class="tool-block" data-tools>
        <summary class="tool-block-title" data-tools-summary>${he.escape(summary)}</summary>
        ${body}
      </details>
    </section>`;
}

function renderProject(project: ConsentProject): string {
  if (project.kind === 'all') {
    return 'All projects you can access';
  }
  return he.escape(project.projectId);
}

function renderCategories(categories: ConsentCategories): string {
  if (categories.kind === 'all') {
    return 'All categories';
  }
  if (categories.kind === 'none') {
    return 'None';
  }
  return categories.labels.join(', ');
}

function renderGrantSummary(view: ConsentView): string {
  const projectValue =
    view.project.kind === 'one'
      ? `<span class="mono">${renderProject(view.project)}</span>`
      : renderProject(view.project);

  const unknownHtml =
    view.unknownCategoryValues.length > 0
      ? `<p class="note">Ignored category values: ${he.escape(
          view.unknownCategoryValues.join(', '),
        )}.</p>`
      : '';

  const emptyGrantHtml =
    view.categories.kind === 'none' && view.project.kind === 'one'
      ? `<p class="note">No tools are available for this connection.</p>`
      : view.categories.kind === 'none'
        ? `<p class="note">No tool categories. Search and Fetch stay available.</p>`
        : '';

  return `
    <section class="panel">
      <h2>Connection access</h2>
      <dl class="facts">
        <div>
          <dt>Project</dt>
          <dd>${projectValue}</dd>
        </div>
        <div>
          <dt>Tool categories</dt>
          <dd>${he.escape(renderCategories(view.categories))}</dd>
        </div>
      </dl>
      ${unknownHtml}
      ${emptyGrantHtml}
    </section>`;
}

function renderScopeSection(view: ConsentView): string {
  const writeCheckedAttr = view.writeChecked ? 'checked' : '';
  const mode = view.writeChecked
    ? 'Read and write'
    : SCOPE_DEFINITIONS.read.label;
  const connectionNote = view.readOnlyRequestedByConnection
    ? `<p class="note">This connection requested read-only access. You can allow writes for this authorization.</p>`
    : '';

  return `
    <section class="panel">
      <h2>Permissions</h2>
      <p class="access-mode" data-access-mode>${mode}</p>
      <input type="hidden" name="scopes" value="read" />
      <label class="write-option">
        <input
          type="checkbox"
          name="scopes"
          value="write"
          ${writeCheckedAttr}
          class="scope-checkbox"
        />
        <span>
          <span class="write-label">${he.escape(SCOPE_DEFINITIONS.write.label)}</span>
          <span class="write-help">${he.escape(SCOPE_DEFINITIONS.write.description)}</span>
        </span>
      </label>
      ${connectionNote}
    </section>`;
}

export function renderConsentHtml(props: ConsentDialogProps): string {
  const view = buildConsentView(props);
  const client = props.client;
  const clientName = he.escape(client.client_name || 'A new MCP Client');
  const website = client.client_uri ? he.escape(client.client_uri) : undefined;
  const redirectUris = client.redirect_uris;

  const websiteHtml = website
    ? `<a href="${website}" target="_blank" rel="noopener noreferrer">${website}</a>`
    : '';

  const redirectUrisHtml =
    redirectUris && redirectUris.length > 0
      ? redirectUris
          .map(
            (uri) => `<span class="mono">Redirects to ${he.escape(uri)}</span>`,
          )
          .join('')
      : '';

  const clientMeta = [websiteHtml, redirectUrisHtml].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect ${clientName} to Neon</title>
  <style>
    :root {
      --text: #e8e8e8;
      --muted: #8b8b8b;
      --bg: #111111;
      --card: #181818;
      --line: #2a2a2a;
      --green: #00e599;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
        Arial, sans-serif;
      line-height: 1.45;
      color: var(--text);
      background: var(--bg);
    }

    .page {
      max-width: 36rem;
      margin: 0 auto;
      padding: 2.5rem 1.25rem 3rem;
    }

    .brand {
      display: block;
      width: 2rem;
      height: 2rem;
      margin-bottom: 1.5rem;
    }

    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .client-name {
      font-size: 0.95rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
    }

    .client-meta {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      margin-top: 0.35rem;
      font-size: 0.8rem;
      color: var(--muted);
    }

    .client-meta a {
      color: var(--muted);
    }

    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 1.25rem 1.25rem 0.25rem;
    }

    .panel {
      padding: 1.1rem 0;
      border-top: 1px solid var(--line);
    }

    .panel:first-of-type {
      border-top: 0;
      padding-top: 0.25rem;
    }

    .facts {
      margin: 0;
      display: grid;
      gap: 0.65rem;
    }

    .facts > div {
      display: grid;
      grid-template-columns: 8.5rem 1fr;
      gap: 0.75rem;
      align-items: baseline;
    }

    dt {
      margin: 0;
      color: var(--muted);
      font-size: 0.85rem;
    }

    dd {
      margin: 0;
      font-size: 0.95rem;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      word-break: break-all;
    }

    .note {
      color: var(--muted);
      font-size: 0.8rem;
      margin: 0.75rem 0 0;
    }

    .access-mode {
      margin: 0 0 0.75rem;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .write-option {
      display: flex;
      gap: 0.7rem;
      align-items: flex-start;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      cursor: pointer;
    }

    .write-option:hover {
      border-color: rgba(0, 229, 153, 0.45);
    }

    .scope-checkbox {
      width: 1.05rem;
      height: 1.05rem;
      margin: 0.15rem 0 0;
      accent-color: var(--green);
      flex-shrink: 0;
    }

    .write-label {
      display: block;
      font-weight: 600;
    }

    .write-help {
      display: block;
      margin-top: 0.2rem;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .tool-block {
      margin-top: 1rem;
    }

    .tool-block-title {
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 0.45rem;
    }

    .write-badge {
      margin-left: 0.35rem;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    details.tool-block > summary {
      cursor: pointer;
      list-style: none;
    }

    details.tool-block > summary::-webkit-details-marker {
      display: none;
    }

    details.tool-block > summary::after {
      content: 'Show';
      float: right;
      font-weight: 500;
      color: var(--muted);
    }

    details.tool-block[open] > summary::after {
      content: 'Hide';
    }

    .tool-group {
      margin: 0.55rem 0 0;
    }

    .tool-group-label {
      font-size: 0.75rem;
      color: var(--muted);
      margin-bottom: 0.2rem;
    }

    .tool-list {
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.85rem;
    }

    .tool-list li {
      padding: 0.12rem 0;
    }

    .empty-tools {
      color: var(--muted);
      font-size: 0.85rem;
      margin: 0.4rem 0 0;
    }

    .next-step {
      margin: 1.25rem 0 0;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
      margin: 1.1rem 0 1rem;
    }

    .button {
      padding: 0.55rem 0.9rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
    }

    .button-primary {
      background: var(--green);
      color: #111;
      border: none;
    }

    .button-secondary {
      background: transparent;
      border: 1px solid var(--line);
      color: var(--text);
    }

    @media (max-width: 640px) {
      .facts > div {
        grid-template-columns: 1fr;
        gap: 0.15rem;
      }

      .actions {
        flex-direction: column-reverse;
      }

      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <a href="/" target="_blank">
      <img class="brand" src="https://neon.com/brand/neon-logomark-dark-color.svg" alt="Neon">
    </a>
    <h1>Connect ${clientName} to Neon</h1>
    <div class="client-name">
      ${clientName}
      <div class="client-meta">${clientMeta}</div>
    </div>
    <form method="POST" action="/api/authorize" id="authorize-form" class="card">
      <input type="hidden" name="state" value="${he.escape(props.state)}" />
      ${renderGrantSummary(view)}
      ${renderScopeSection(view)}
      ${renderToolSections(view)}
      <p class="next-step">
        Next, you will sign in to Neon. That step does not use the project,
        category, or write limits above.
      </p>
      <div class="actions">
        <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
        <button type="submit" class="button button-primary">Approve and continue to Neon</button>
      </div>
    </form>
  </div>
  <script>
    function toolsSummaryFromDom(checked) {
      var visible = 0;
      var categories = 0;
      document.querySelectorAll('.tool-group').forEach(function (group) {
        var groupVisible = false;
        group.querySelectorAll('li').forEach(function (item) {
          var isWrite = item.hasAttribute('data-write-tool');
          var show = checked || !isWrite;
          item.hidden = !show;
          if (show) {
            visible += 1;
            groupVisible = true;
          }
        });
        group.hidden = !groupVisible;
        if (groupVisible) {
          categories += 1;
        }
      });
      var categoryWord = categories === 1 ? 'category' : 'categories';
      var mode = checked ? 'read and write' : 'read-only';
      return 'Tools · ' + visible + ' in ' + categories + ' ' + categoryWord + ' · ' + mode;
    }

    function syncConsentUi() {
      var writeCheckbox = document.querySelector('.scope-checkbox');
      var checked = !!(writeCheckbox && writeCheckbox.checked);
      var mode = document.querySelector('[data-access-mode]');
      if (mode) {
        mode.textContent = checked ? 'Read and write' : 'Read-only';
      }
      var summary = document.querySelector('[data-tools-summary]');
      if (summary) {
        summary.textContent = toolsSummaryFromDom(checked);
      }
      var url = new URL(window.location.href);
      url.searchParams.set('scope', checked ? 'read write' : 'read');
      window.history.replaceState({}, '', url.toString());
    }

    var writeCheckbox = document.querySelector('.scope-checkbox');
    if (writeCheckbox) {
      writeCheckbox.addEventListener('change', syncConsentUi);
    }
  </script>
</body>
</html>`;
}
