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

type ConsentTool = {
  name: string;
  title: string;
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
  client: object;
  state: string;
  requestedScopes: string[];
  defaultReadOnly: boolean;
  readOnlyRequestedByConnection: boolean;
  grant: GrantContext;
};

function pickString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function pickStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    return undefined;
  }
  return value;
}

function consentClientFields(client: object): ConsentClient {
  const record = Object.fromEntries(Object.entries(client));
  return {
    client_name: pickString(record, 'client_name'),
    client_uri: pickString(record, 'client_uri'),
    redirect_uris: pickStringArray(record, 'redirect_uris'),
  };
}

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

function renderChips(tools: ConsentTool[]): string {
  if (tools.length === 0) {
    return `<p class="empty-tools">None.</p>`;
  }
  return `<div class="tool-chips">${tools
    .map((tool) => `<span class="tool-chip">${he.escape(tool.title)}</span>`)
    .join('')}</div>`;
}

function renderProject(project: ConsentProject): string {
  if (project.kind === 'all') {
    return 'All projects in the Neon account you sign in with';
  }
  return he.escape(project.projectId);
}

function renderCategories(categories: ConsentCategories): string {
  if (categories.kind === 'all') {
    return SCOPE_CATEGORIES.map((id) => SCOPE_CATEGORY_LABELS[id]).join(', ');
  }
  if (categories.kind === 'none') {
    return 'None';
  }
  return categories.labels.join(', ');
}

function renderGrantSummary(view: ConsentView): string {
  const projectValue =
    view.project.kind === 'one'
      ? `<span class="detail-value">${renderProject(view.project)}</span>`
      : `<span>${renderProject(view.project)}</span>`;

  const unknownHtml =
    view.unknownCategoryValues.length > 0
      ? `<p class="grant-note">Ignored category values: ${he.escape(
          view.unknownCategoryValues.join(', '),
        )}.</p>`
      : '';

  const discoveryHtml =
    view.project.kind === 'all'
      ? `<p class="grant-note">Search and Fetch stay available for every category selection unless the connection is limited to one project.</p>`
      : '';

  const emptyGrantHtml =
    view.categories.kind === 'none' && view.project.kind === 'one'
      ? `<p class="grant-note">No tools are available for this connection.</p>`
      : view.categories.kind === 'none'
        ? `<p class="grant-note">No tool categories. Search and Fetch stay available.</p>`
        : '';

  const writeSection =
    view.writeOnlyTools.length === 0
      ? ''
      : `
        <div class="grant-subsection${view.writeChecked ? '' : ' is-pending'}" data-write-tools>
          <div class="grant-subtitle">Included if you grant Full access</div>
          <p class="grant-note">These stay limited to the project and categories above.</p>
          ${renderChips(view.writeOnlyTools)}
        </div>`;

  return `
    <div class="scope-section">
      <div class="scope-section-title">Access this connection is requesting</div>
      <div class="grant-rows">
        <div class="grant-row">
          <div class="detail-label">Project</div>
          <div>${projectValue}</div>
        </div>
        <div class="grant-row">
          <div class="detail-label">Tool categories</div>
          <div>${he.escape(renderCategories(view.categories))}</div>
        </div>
      </div>
      ${unknownHtml}
      ${discoveryHtml}
      ${emptyGrantHtml}
      <div class="grant-subsection">
        <div class="grant-subtitle">Included now</div>
        ${renderChips(view.readTools)}
      </div>
      ${writeSection}
    </div>`;
}

function renderScopeSection(view: ConsentView): string {
  const writeCheckedAttr = view.writeChecked ? 'checked' : '';
  const connectionNote = view.readOnlyRequestedByConnection
    ? `<p class="grant-note">The connection URL requested read-only. Checking Full access grants writes for this authorization.</p>`
    : '';

  return `
    <input type="hidden" name="scopes" value="read" />
    <div class="scope-item scope-granted">
      <span class="scope-check">✓</span>
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.read.label)}</span>
        <span class="scope-description">${he.escape(SCOPE_DEFINITIONS.read.description)}</span>
      </div>
    </div>
    <label class="scope-item scope-option">
      <input
        type="checkbox"
        name="scopes"
        value="write"
        ${writeCheckedAttr}
        class="scope-checkbox"
      />
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.write.label)}</span>
        <span class="scope-description">${he.escape(
          'Create, update, and delete Neon resources and run write SQL. Still limited to the project and tool categories listed above.',
        )}</span>
      </div>
    </label>
    ${connectionNote}`;
}

export function renderConsentHtml(props: ConsentDialogProps): string {
  const view = buildConsentView(props);
  const client = consentClientFields(props.client);
  const clientName = he.escape(client.client_name || 'A new MCP Client');
  const website = client.client_uri ? he.escape(client.client_uri) : undefined;
  const redirectUris = client.redirect_uris;

  const websiteHtml = website
    ? `
          <div class="client-detail">
            <div class="detail-label">Website:</div>
            <div class="detail-value small">
              <a href="${website}" target="_blank" rel="noopener noreferrer">${website}</a>
            </div>
          </div>`
    : '';

  const redirectUrisHtml =
    redirectUris && redirectUris.length > 0
      ? `
          <div class="client-detail">
            <div class="detail-label">Redirect URIs:</div>
            <div class="detail-value small">
              ${redirectUris.map((uri) => `<div>${he.escape(uri)}</div>`).join('')}
            </div>
          </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${clientName} | Authorization Request</title>
  <style>
    :root {
      --primary-color: #0070f3;
      --error-color: #f44336;
      --text-color: #dedede;
      --text-color-secondary: #949494;
      --background-color: #1c1c1c;
      --border-color: #2a2929;
      --card-shadow: 0 0px 12px 0px rgb(0 230 153 / 0.3);
      --link-color: rgb(0 230 153 / 1);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
        Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
      line-height: 1.6;
      color: var(--text-color);
      background-color: var(--background-color);
      margin: 0;
      padding: 0;
    }

    .container {
      max-width: 640px;
      margin: 2rem auto;
      padding: 1rem;
    }

    .precard {
      padding: 2rem;
      text-align: center;
    }

    .card {
      background-color: #0a0c09e6;
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      padding: 2rem;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
      color: var(--text-color);
      text-decoration: none;
    }

    .logo {
      width: 48px;
      height: 48px;
      margin-right: 1rem;
      border-radius: 8px;
      object-fit: contain;
    }

    .alert {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 400;
      margin: 1rem 0;
      text-align: center;
    }

    .description {
      color: var(--text-color-secondary);
    }

    .client-info {
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1rem 1rem 0.5rem;
      margin-bottom: 1.5rem;
    }

    .client-detail {
      display: flex;
      margin-bottom: 0.5rem;
      align-items: baseline;
    }

    .detail-label {
      font-weight: 500;
      min-width: 120px;
    }

    .detail-value {
      font-family: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
        'Courier New', monospace;
      word-break: break-all;
    }

    .detail-value a {
      color: inherit;
      text-decoration: underline;
    }

    .detail-value.small {
      font-size: 0.8em;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
    }

    .button {
      padding: 0.65rem 1rem;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-size: 1rem;
    }

    .button-primary {
      background-color: rgb(0 229 153 / 1);
      color: rgb(26 26 26 / 1);
    }

    .button-secondary {
      background-color: transparent;
      border: 1px solid rgb(73 75 80 / 1);
      color: var(--text-color);
    }

    .scope-section {
      margin: 1.5rem 0;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
    }

    .scope-section-title {
      font-weight: 500;
      margin-bottom: 1rem;
      color: var(--text-color);
    }

    .grant-rows {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }

    .grant-row {
      display: flex;
      gap: 1rem;
      align-items: baseline;
    }

    .grant-note {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0.5rem 0 0;
    }

    .grant-subsection {
      margin-top: 1rem;
    }

    .grant-subsection.is-pending {
      opacity: 0.55;
    }

    .grant-subtitle {
      font-weight: 500;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }

    .tool-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .tool-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.2rem 0.5rem;
      font-family: SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
        'Courier New', monospace;
      font-size: 0.75rem;
    }

    .empty-tools {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin: 0;
    }

    .scope-item {
      display: flex;
      align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }

    .scope-option {
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
    }

    .scope-option:hover {
      border-color: rgba(0, 230, 153, 0.5);
      background-color: rgba(0, 230, 153, 0.05);
    }

    .scope-granted {
      background-color: rgba(0, 230, 153, 0.05);
      border-color: rgba(0, 230, 153, 0.3);
    }

    .scope-check {
      color: rgb(0, 229, 153);
      font-size: 1rem;
      margin-right: 0.75rem;
      margin-top: 2px;
      flex-shrink: 0;
    }

    .scope-checkbox {
      width: 18px;
      height: 18px;
      margin-right: 0.75rem;
      margin-top: 2px;
      accent-color: rgb(0, 229, 153);
      cursor: pointer;
      flex-shrink: 0;
    }

    .scope-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .scope-label {
      font-weight: 500;
      color: var(--text-color);
    }

    .scope-description {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    @media (max-width: 640px) {
      .container {
        margin: 1rem auto;
        padding: 0.5rem;
      }

      .card {
        padding: 1.5rem;
      }

      .client-detail,
      .grant-row {
        flex-direction: column;
      }

      .detail-label {
        min-width: unset;
        margin-bottom: 0.25rem;
      }

      .actions {
        flex-direction: column;
      }

      .button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="precard">
      <a class="header" href="/" target="_blank">
        <img src="https://neon.com/brand/neon-logomark-dark-color.svg" alt="Neon MCP" class="logo">
      </a>
    </div>
    <div class="card">
      <h2 class="alert"><strong>MCP Client Authorization Request</strong></h2>
      <div class="client-info">
        <div class="client-detail">
          <div class="detail-label">Name:</div>
          <div class="detail-value">${clientName}</div>
        </div>${websiteHtml}${redirectUrisHtml}
      </div>
      <p class="description">
        This is the access this authorization is requesting for
        <strong>${clientName}</strong>.
      </p>
      <form method="POST" action="/api/authorize" id="authorize-form">
        <input type="hidden" name="state" value="${he.escape(props.state)}" />
        ${renderGrantSummary(view)}
        <div class="scope-section">
          <div class="scope-section-title">Permissions:</div>
          ${renderScopeSection(view)}
        </div>
        <p class="grant-note">
          After you approve, you will sign in to Neon. That step asks for org
          and project management on your Neon account. It does not use the MCP
          project, category, or read-only choices on this page.
        </p>
        <div class="actions">
          <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
          <button type="submit" class="button button-primary">Approve</button>
        </div>
      </form>
    </div>
  </div>
  <script>
    function updateUrlScope() {
      var writeCheckbox = document.querySelector('.scope-checkbox');
      var scopes = ['read'];
      if (writeCheckbox && writeCheckbox.checked) {
        scopes.push('write');
      }
      var url = new URL(window.location.href);
      url.searchParams.set('scope', scopes.join(' '));
      window.history.replaceState({}, '', url.toString());
    }

    function syncWriteTools() {
      var writeCheckbox = document.querySelector('.scope-checkbox');
      var writeTools = document.querySelector('[data-write-tools]');
      if (!writeTools) {
        return;
      }
      if (!writeCheckbox || writeCheckbox.checked) {
        writeTools.classList.remove('is-pending');
      } else {
        writeTools.classList.add('is-pending');
      }
    }

    var writeCheckbox = document.querySelector('.scope-checkbox');
    if (writeCheckbox) {
      writeCheckbox.addEventListener('change', function () {
        updateUrlScope();
        syncWriteTools();
      });
    }
  </script>
</body>
</html>`;
}
