import { NextRequest, NextResponse } from 'next/server';
import he from 'he';
import { model } from '../../../mcp-src/oauth/model';
import { upstreamAuth } from '../../../lib/oauth/client';
import {
  isClientAlreadyApproved,
  updateApprovedClientsCookie,
} from '../../../lib/oauth/cookies';
import { COOKIE_SECRET } from '../../../lib/config';
import { handleOAuthError } from '../../../lib/errors';
import {
  hasWriteScope,
  SCOPE_DEFINITIONS,
  SUPPORTED_SCOPES,
} from '../../../mcp-src/utils/read-only';
import { logger } from '../../../mcp-src/utils/logger';
import { matchesRedirectUri } from '../../../lib/oauth/redirect-uri';
import {
  PRESETS,
  PRESET_DEFINITIONS,
  SCOPE_CATEGORIES,
  SCOPE_CATEGORY_DEFINITIONS,
  type GrantContext,
  type Preset,
  type ScopeCategory,
} from '../../../mcp-src/utils/grant-context';
import { NEON_TOOLS } from '../../../mcp-src/tools/definitions';

/**
 * Generates minimal tool data for client-side filtering and display.
 */
function getToolDataJson(): string {
  const data = NEON_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.annotations?.title ?? tool.name,
    scope: tool.scope,
    readOnly: tool.readOnlySafe,
    destructive: !!tool.annotations?.destructiveHint,
  }));
  return JSON.stringify(data);
}

/**
 * Generates scope category labels for client-side display.
 */
function getScopeLabelsJson(): string {
  const labels: Record<string, string> = {};
  for (const cat of SCOPE_CATEGORIES) {
    labels[cat] = SCOPE_CATEGORY_DEFINITIONS[cat].label;
  }
  return JSON.stringify(labels);
}

export type DownstreamAuthRequest = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  grant?: GrantContext;
};

const parseAuthRequest = (
  searchParams: URLSearchParams,
): DownstreamAuthRequest => {
  const responseType = searchParams.get('response_type') || '';
  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state') || '';
  const codeChallenge = searchParams.get('code_challenge') || undefined;
  const codeChallengeMethod =
    searchParams.get('code_challenge_method') || 'plain';

  return {
    responseType,
    clientId,
    redirectUri,
    scope: scope.split(' ').filter(Boolean),
    state,
    codeChallenge,
    codeChallengeMethod,
  };
};

/**
 * Renders scope category checkboxes for the custom preset.
 */
function renderScopeCategoryCheckboxes(): string {
  let html = '';
  for (const category of SCOPE_CATEGORIES) {
    const def = SCOPE_CATEGORY_DEFINITIONS[category];
    const sensitiveHtml = def.sensitive
      ? ' <span class="badge badge-sensitive">SENSITIVE</span>'
      : '';
    html += `
      <label class="category-item">
        <input
          type="checkbox"
          name="scope_categories"
          value="${he.escape(category)}"
          checked
          class="scope-checkbox"
        />
        <div class="scope-info">
          <span class="scope-label">${he.escape(def.label)}${sensitiveHtml}</span>
          <span class="scope-description">${he.escape(def.description)}</span>
        </div>
      </label>
    `;
  }
  return html;
}

/**
 * Renders scope categories as read-only indicators for the permission details view.
 */
function renderPermissionDetailItems(): string {
  let html = '';
  for (const category of SCOPE_CATEGORIES) {
    const def = SCOPE_CATEGORY_DEFINITIONS[category];
    const sensitiveHtml = def.sensitive
      ? ' <span class="badge badge-sensitive">SENSITIVE</span>'
      : '';
    html += `
      <div class="category-detail">
        <span class="detail-check">\u2713</span>
        <div class="scope-info">
          <span class="scope-label">${he.escape(def.label)}${sensitiveHtml}</span>
          <span class="scope-description">${he.escape(def.description)}</span>
        </div>
      </div>
    `;
  }
  return html;
}

/**
 * Renders the preset selection UI with tab-style buttons, scope category
 * checkboxes for custom preset, collapsible permission details, branch
 * protection, and caution banner.
 */
function renderPresetSection(projectId: string | null): string {
  // Hidden inputs for OAuth scopes (updated by JS based on preset)
  let html = `<input type="hidden" name="scopes" value="read" />`;
  html += `<input type="hidden" name="scopes" value="write" id="write-scope-input" />`;
  html += `<input type="hidden" name="preset" value="full_access" id="preset-input" />`;

  // Preset tab group
  html += `<div class="preset-label">Presets</div>`;
  html += `<div class="preset-tabs">`;
  const presetOrder: Preset[] = [
    'custom',
    'local_development',
    'production_use',
    'full_access',
  ];
  for (const preset of presetOrder) {
    const def = PRESET_DEFINITIONS[preset];
    const isDefault = preset === 'full_access';
    html += `
      <button
        type="button"
        class="preset-tab${isDefault ? ' active' : ''}"
        data-preset="${he.escape(preset)}"
        data-readonly="${preset === 'production_use' ? 'true' : 'false'}"
        data-desc="${he.escape(def.description)}"
      >${he.escape(def.label)}</button>
    `;
  }
  html += `</div>`;

  // Preset description (updated dynamically by JS)
  html += `<p class="preset-description" id="preset-desc">${he.escape(PRESET_DEFINITIONS.full_access.description)}</p>`;

  // Permission details (collapsible, shown for non-custom presets)
  html += `
    <details class="permission-details" id="perm-details">
      <summary>Show permission details</summary>
      <div class="categories-readonly">
        ${renderPermissionDetailItems()}
      </div>
    </details>
  `;

  // Custom scope categories (hidden by default, shown when custom is selected)
  html += `
    <div class="scope-categories" id="scope-categories" style="display: none;">
      ${renderScopeCategoryCheckboxes()}
    </div>
  `;

  // Project scope
  const projectIdValue = projectId ? he.escape(projectId) : '';
  const projectIdReadonly = projectId ? ' readonly' : '';
  html += `
    <div class="project-scope-section">
      <div class="scope-info">
        <span class="scope-label">Project scope</span>
        <span class="scope-description">Restrict access to a single Neon project (optional)</span>
      </div>
      <input
        type="text"
        name="project_id"
        id="project-id-input"
        class="project-id-input"
        placeholder="proj-abc-123"
        value="${projectIdValue}"${projectIdReadonly}
      />
    </div>
  `;

  // Protect production branches
  html += `
    <div class="protect-section">
      <label class="protect-label">
        <input
          type="checkbox"
          name="protect_production"
          value="true"
          class="scope-checkbox"
          id="protect-production"
        />
        <div class="scope-info">
          <span class="scope-label">Protect production branches</span>
          <span class="scope-description">Prevent branch deletion and SQL execution on branches named <code>main</code>, <code>prod</code>, or <code>production</code></span>
        </div>
      </label>
    </div>
  `;

  // Tools preview (populated by client-side JS)
  html += `
    <div class="tools-preview" id="tools-preview">
      <div class="tools-preview-header">
        <span class="tools-preview-title">Included tools</span>
        <span class="tools-preview-count" id="tools-count"></span>
      </div>
      <div class="tools-preview-content" id="tools-content"></div>
    </div>
  `;

  // Caution banner
  html += `
    <div class="caution-banner">
      <strong>Caution:</strong> AI agents can make mistakes. We recommend avoiding SQL execution on production databases.
      Use branch protection and consider read-only access for sensitive environments.
    </div>
  `;

  return html;
}

/**
 * Renders the scope selection as read-only display (when preset is pre-configured).
 */
function renderScopeSection(requestedScopes: string[]): string {
  const writeChecked =
    requestedScopes.length === 0 || hasWriteScope(requestedScopes);

  let html = `<input type="hidden" name="scopes" value="read" />`;

  html += `
    <div class="scope-item scope-granted">
      <span class="scope-check">\u2713</span>
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.read.label)}</span>
        <span class="scope-description">${he.escape(SCOPE_DEFINITIONS.read.description)}</span>
      </div>
    </div>
  `;

  html += `
    <label class="scope-item scope-option">
      <input
        type="checkbox"
        name="scopes"
        value="write"
        ${writeChecked ? 'checked' : ''}
        class="scope-checkbox"
      />
      <div class="scope-info">
        <span class="scope-label">${he.escape(SCOPE_DEFINITIONS.write.label)}</span>
        <span class="scope-description">${he.escape(SCOPE_DEFINITIONS.write.description)}</span>
      </div>
    </label>
  `;

  return html;
}

// Generate approval dialog HTML
const renderApprovalDialog = (
  client: {
    client_name?: string;
    client_uri?: string;
    redirect_uris?: string[];
    [key: string]: unknown;
  },
  state: string,
  requestedScopes: string[],
  projectId: string | null = null,
  showPresets: boolean = true,
) => {
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

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${clientName} | Authorization Request</title>
  <style>
    :root {
      --neon-green: rgb(0 229 153);
      --neon-green-dim: rgba(0, 230, 153, 0.15);
      --neon-green-border: rgba(0, 230, 153, 0.3);
      --text-color: #dedede;
      --text-color-secondary: #949494;
      --background-color: #1c1c1c;
      --border-color: #2a2929;
      --card-bg: #0a0c09e6;
      --card-shadow: 0 0px 12px 0px rgb(0 230 153 / 0.3);
      --sensitive-color: #f59e0b;
      --caution-bg: rgba(245, 158, 11, 0.08);
      --caution-border: rgba(245, 158, 11, 0.3);
    }

    *, *::before, *::after { box-sizing: border-box; }

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
      max-width: 600px;
      margin: 2rem auto;
      padding: 1rem;
    }

    .precard {
      padding: 1.5rem 2rem;
      text-align: center;
    }

    .logo {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      object-fit: contain;
    }

    .card {
      background-color: var(--card-bg);
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      padding: 2rem;
    }

    .alert {
      margin: 0 0 1.5rem;
      font-size: 1.4rem;
      font-weight: 400;
      text-align: center;
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

    .description {
      color: var(--text-color-secondary);
      margin-bottom: 0;
    }

    /* Permissions section */
    .scope-section {
      margin: 1.5rem 0;
      padding-top: 1rem;
      border-top: 1px solid var(--border-color);
    }

    .scope-section-title {
      font-weight: 600;
      font-size: 1.1rem;
      margin-bottom: 1rem;
      color: var(--text-color);
    }

    /* Preset tabs */
    .preset-label {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .preset-tabs {
      display: flex;
      gap: 0;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 0.75rem;
    }

    .preset-tab {
      flex: 1;
      padding: 0.55rem 0.25rem;
      background: transparent;
      color: var(--text-color-secondary);
      border: none;
      border-right: 1px solid var(--border-color);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 500;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .preset-tab:last-child {
      border-right: none;
    }

    .preset-tab:hover {
      color: var(--text-color);
      background-color: rgba(255, 255, 255, 0.03);
    }

    .preset-tab.active {
      background-color: var(--neon-green);
      color: #1a1a1a;
      font-weight: 600;
    }

    .preset-description {
      font-size: 0.85rem;
      color: var(--text-color-secondary);
      margin: 0 0 1rem;
      line-height: 1.4;
    }

    /* Permission details (collapsible) */
    .permission-details {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .permission-details summary {
      padding: 0.75rem 1rem;
      cursor: pointer;
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--text-color);
      user-select: none;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .permission-details summary::after {
      content: '\\25B8';
      transition: transform 0.2s;
      font-size: 0.75rem;
    }

    .permission-details[open] summary::after {
      transform: rotate(90deg);
    }

    .permission-details summary::-webkit-details-marker {
      display: none;
    }

    .categories-readonly {
      padding: 0 1rem 0.25rem;
      border-top: 1px solid var(--border-color);
    }

    .category-detail {
      display: flex;
      align-items: flex-start;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-color);
    }

    .category-detail:last-child {
      border-bottom: none;
    }

    .detail-check {
      color: var(--neon-green);
      font-size: 0.9rem;
      margin-right: 0.75rem;
      margin-top: 2px;
      flex-shrink: 0;
    }

    /* Scope categories (custom preset) */
    .scope-categories {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .category-item {
      display: flex;
      align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
    }

    .category-item:hover {
      border-color: var(--neon-green-border);
      background-color: rgba(0, 230, 153, 0.03);
    }

    .scope-checkbox {
      width: 18px;
      height: 18px;
      margin-right: 0.75rem;
      margin-top: 2px;
      accent-color: var(--neon-green);
      cursor: pointer;
      flex-shrink: 0;
    }

    .scope-info {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .scope-label {
      font-weight: 500;
      color: var(--text-color);
      font-size: 0.925rem;
    }

    .scope-description {
      font-size: 0.8rem;
      color: var(--text-color-secondary);
      line-height: 1.4;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 0.6rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      vertical-align: middle;
      margin-left: 0.4rem;
    }

    .badge-sensitive {
      background-color: rgba(245, 158, 11, 0.15);
      color: var(--sensitive-color);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    /* Project scope section */
    .project-scope-section {
      margin-top: 1.25rem;
      margin-bottom: 1rem;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }

    .project-scope-section .scope-info {
      margin-bottom: 0.5rem;
    }

    .project-id-input {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background-color: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-color);
      font-size: 0.875rem;
      font-family: monospace;
      outline: none;
      transition: border-color 0.2s;
    }

    .project-id-input::placeholder {
      color: var(--text-color-secondary);
      opacity: 0.5;
    }

    .project-id-input:focus {
      border-color: var(--neon-green-border);
    }

    .project-id-input[readonly] {
      background-color: rgba(255, 255, 255, 0.02);
      color: var(--text-color-secondary);
      cursor: not-allowed;
    }

    /* Protect section */
    .protect-section {
      margin-top: 1.25rem;
      margin-bottom: 1rem;
    }

    .protect-label {
      display: flex;
      align-items: flex-start;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
    }

    .protect-label:hover {
      border-color: var(--neon-green-border);
      background-color: rgba(0, 230, 153, 0.03);
    }

    .protect-label code {
      background-color: rgba(255, 255, 255, 0.08);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    /* Caution banner */
    .caution-banner {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background-color: var(--caution-bg);
      border: 1px solid var(--caution-border);
      font-size: 0.8rem;
      color: var(--sensitive-color);
      line-height: 1.5;
    }

    /* Tools preview */
    .tools-preview {
      margin: 1.25rem 0 1rem;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }

    .tools-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .tools-preview-title {
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--text-color);
    }

    .tools-preview-count {
      font-size: 0.7rem;
      color: var(--text-color-secondary);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
      border: 1px solid var(--border-color);
    }

    .tools-preview-content {
      max-height: 260px;
      overflow-y: auto;
    }

    .tools-preview-content::-webkit-scrollbar {
      width: 4px;
    }

    .tools-preview-content::-webkit-scrollbar-track {
      background: transparent;
    }

    .tools-preview-content::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 2px;
    }

    .tool-group {
      margin-bottom: 0.6rem;
    }

    .tool-group:last-child {
      margin-bottom: 0;
    }

    .tool-group-label {
      font-size: 0.65rem;
      color: var(--text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.3rem;
    }

    .tool-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .tool-chip {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.68rem;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      color: var(--text-color-secondary);
      white-space: nowrap;
      line-height: 1.4;
    }

    .tool-chip.tool-write {
      border-color: rgba(0, 230, 153, 0.2);
      color: var(--text-color);
    }

    .tool-chip.tool-destructive {
      border-color: rgba(245, 158, 11, 0.25);
      color: var(--sensitive-color);
    }

    /* Actions */
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 1.5rem;
    }

    .button {
      padding: 0.65rem 1.5rem;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-size: 1rem;
    }

    .button-primary {
      background-color: var(--neon-green);
      color: #1a1a1a;
    }

    .button-primary:hover {
      opacity: 0.9;
    }

    .button-secondary {
      background-color: transparent;
      border: 1px solid rgb(73 75 80);
      color: var(--text-color);
    }

    .button-secondary:hover {
      background-color: rgba(255, 255, 255, 0.03);
    }

    /* Footer */
    .page-footer {
      text-align: center;
      padding: 1.5rem 1rem;
      font-size: 0.8rem;
      color: var(--text-color-secondary);
    }

    .page-footer a {
      color: var(--neon-green);
      text-decoration: none;
    }

    .page-footer a:hover {
      text-decoration: underline;
    }

    .footer-brand {
      margin-top: 0.75rem;
      font-size: 0.75rem;
    }

    /* Scope section (non-preset mode / renderScopeSection) */
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
      border-color: var(--neon-green-border);
      background-color: rgba(0, 230, 153, 0.03);
    }

    .scope-granted {
      background-color: var(--neon-green-dim);
      border-color: var(--neon-green-border);
    }

    .scope-check {
      color: var(--neon-green);
      font-size: 1rem;
      margin-right: 0.75rem;
      margin-top: 2px;
      flex-shrink: 0;
    }

    @media (max-width: 640px) {
      .container {
        margin: 1rem auto;
        padding: 0.5rem;
      }

      .card {
        padding: 1.5rem;
      }

      .preset-tabs {
        flex-wrap: wrap;
      }

      .preset-tab {
        flex: 1 1 45%;
        border-bottom: 1px solid var(--border-color);
      }

      .client-detail {
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
      <a href="https://neon.tech" target="_blank" rel="noopener noreferrer">
        <img src="/brand/neon-logomark-dark-color.svg" alt="Neon" class="logo">
      </a>
    </div>
    <div class="card">
      <h2 class="alert">Authorize <strong>${clientName}</strong></h2>
      <div class="client-info">
        <div class="client-detail">
          <div class="detail-label">Name:</div>
          <div class="detail-value">${clientName}</div>
        </div>${websiteHtml}${redirectUrisHtml}
      </div>
      <p class="description">
        This MCP client is requesting access to your Neon account.
        If you approve, you will be redirected to complete authentication.
      </p>
      <form method="POST" action="/api/authorize" id="authorize-form">
        <input type="hidden" name="state" value="${he.escape(state)}" />
        <div class="scope-section">
          <div class="scope-section-title">Select Permissions</div>
          ${showPresets ? renderPresetSection(projectId) : renderScopeSection(requestedScopes)}
        </div>
        <div class="actions">
          <button type="button" class="button button-secondary" onclick="window.history.back()">Deny</button>
          <button type="submit" class="button button-primary">Approve</button>
        </div>
      </form>
    </div>
    <div class="page-footer">
      <div>By authorizing, you agree to Neon&rsquo;s <a href="https://neon.tech/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="https://neon.tech/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></div>
      <div class="footer-brand">Neon Serverless Postgres</div>
    </div>
  </div>
  <script>
    // Preset tab handling
    var tabs = document.querySelectorAll('.preset-tab');
    var presetInput = document.getElementById('preset-input');
    var presetDesc = document.getElementById('preset-desc');
    var writeScopeInput = document.getElementById('write-scope-input');
    var scopeCategories = document.getElementById('scope-categories');
    var permDetails = document.getElementById('perm-details');

    function selectPreset(tab) {
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
      }
      tab.classList.add('active');

      var preset = tab.getAttribute('data-preset');
      var isReadOnly = tab.getAttribute('data-readonly') === 'true';
      var desc = tab.getAttribute('data-desc');

      if (presetInput) presetInput.value = preset;
      if (presetDesc) presetDesc.textContent = desc;

      // Update write scope based on preset
      if (writeScopeInput) {
        if (isReadOnly) {
          writeScopeInput.removeAttribute('name');
          writeScopeInput.disabled = true;
        } else {
          writeScopeInput.setAttribute('name', 'scopes');
          writeScopeInput.disabled = false;
        }
      }

      // Toggle custom categories vs permission details
      if (preset === 'custom') {
        if (scopeCategories) scopeCategories.style.display = '';
        if (permDetails) permDetails.style.display = 'none';
      } else {
        if (scopeCategories) scopeCategories.style.display = 'none';
        if (permDetails) {
          permDetails.style.display = '';
          permDetails.removeAttribute('open');
        }
      }

      renderToolPreview();
    }

    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        selectPreset(this);
      });
    }

    // Legacy scope checkbox handler (for renderScopeSection path)
    function updateUrlScope() {
      var writeCheckbox = document.querySelector('.scope-option .scope-checkbox');
      var scopes = ['read'];
      if (writeCheckbox && writeCheckbox.checked) {
        scopes.push('write');
      }
      var url = new URL(window.location.href);
      url.searchParams.set('scope', scopes.join(' '));
      window.history.replaceState({}, '', url.toString());
    }

    var legacyCheckbox = document.querySelector('.scope-option .scope-checkbox');
    if (legacyCheckbox) {
      legacyCheckbox.addEventListener('change', updateUrlScope);
    }

    // Tool preview: data embedded server-side, filtering + rendering client-side
    var TOOLS = ${getToolDataJson()};
    var SCOPE_LABELS = ${getScopeLabelsJson()};
    var ALWAYS_AVAIL = {search:1, fetch:1};
    var LOCAL_BLOCKED = {create_project:1, delete_project:1};
    var PROJ_AGNOSTIC = {list_projects:1, list_organizations:1, list_shared_projects:1, create_project:1, delete_project:1};
    var GROUP_ORDER = ['projects','branches','schema','querying','performance','neon_auth','docs','_general'];

    function getFilteredTools() {
      var preset = presetInput ? presetInput.value : 'full_access';
      var pidEl = document.getElementById('project-id-input');
      var pid = pidEl ? pidEl.value.trim() : '';
      var result = TOOLS.slice();

      if (preset === 'production_use') {
        result = result.filter(function(t) { return t.readOnly || ALWAYS_AVAIL[t.name]; });
      } else if (preset === 'local_development') {
        result = result.filter(function(t) { return !LOCAL_BLOCKED[t.name]; });
      } else if (preset === 'custom') {
        var checked = document.querySelectorAll('#scope-categories input[name="scope_categories"]:checked');
        var sc = {};
        for (var j = 0; j < checked.length; j++) sc[checked[j].value] = 1;
        result = result.filter(function(t) {
          return ALWAYS_AVAIL[t.name] || !t.scope || sc[t.scope];
        });
      }

      if (pid) {
        result = result.filter(function(t) { return !PROJ_AGNOSTIC[t.name]; });
      }

      return result;
    }

    function renderToolPreview() {
      var countEl = document.getElementById('tools-count');
      var contentEl = document.getElementById('tools-content');
      if (!contentEl) return;

      var tools = getFilteredTools();

      if (countEl) {
        countEl.textContent = tools.length + ' tool' + (tools.length !== 1 ? 's' : '');
      }

      var groups = {};
      tools.forEach(function(t) {
        var key = t.scope || '_general';
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });

      var h = '';
      GROUP_ORDER.forEach(function(key) {
        if (!groups[key]) return;
        var label = key === '_general' ? 'Always Available' : (SCOPE_LABELS[key] || key);
        h += '<div class="tool-group">';
        h += '<div class="tool-group-label">' + label + '</div>';
        h += '<div class="tool-chips">';
        groups[key].forEach(function(t) {
          var cls = 'tool-chip';
          if (t.destructive) cls += ' tool-destructive';
          else if (!t.readOnly) cls += ' tool-write';
          h += '<span class="' + cls + '">' + t.title + '</span>';
        });
        h += '</div>';
        h += '</div>';
      });

      contentEl.innerHTML = h;
    }

    // Re-render tools when custom scope checkboxes change
    var scopeCbs = document.querySelectorAll('#scope-categories input[name="scope_categories"]');
    for (var k = 0; k < scopeCbs.length; k++) {
      scopeCbs[k].addEventListener('change', renderToolPreview);
    }

    // Re-render tools when project ID changes (debounced)
    var pidInput = document.getElementById('project-id-input');
    var pidTimer;
    if (pidInput) {
      pidInput.addEventListener('input', function() {
        clearTimeout(pidTimer);
        pidTimer = setTimeout(renderToolPreview, 300);
      });
    }

    // Initial render
    renderToolPreview();
  </script>
</body>
</html>
`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestParams = parseAuthRequest(searchParams);

    const clientId = requestParams.clientId;
    const client = await model.getClient(clientId, '');

    logger.info('Authorize request', {
      clientId,
      redirectUri: requestParams.redirectUri,
      responseType: requestParams.responseType,
      scope: requestParams.scope,
    });

    if (!client) {
      logger.warn('Client not found', { clientId });
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Invalid client ID',
        },
        { status: 400 },
      );
    }

    if (
      requestParams.responseType === undefined ||
      !client.response_types.includes(requestParams.responseType)
    ) {
      logger.warn('Invalid response type', {
        clientId,
        providedResponseType: requestParams.responseType,
        supportedResponseTypes: client.response_types,
      });
      return NextResponse.json(
        {
          error: 'unsupported_response_type',
          error_description: 'Invalid response type',
        },
        { status: 400 },
      );
    }

    if (
      requestParams.redirectUri === undefined ||
      !matchesRedirectUri(requestParams.redirectUri, client.redirect_uris)
    ) {
      logger.warn('Invalid redirect URI', {
        clientId: requestParams.clientId,
        providedRedirectUri: requestParams.redirectUri,
        registeredRedirectUris: client.redirect_uris,
      });
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid redirect URI',
        },
        { status: 400 },
      );
    }

    if (await isClientAlreadyApproved(client.id, COOKIE_SECRET)) {
      const authUrl = await upstreamAuth(btoa(JSON.stringify(requestParams)));
      return NextResponse.redirect(authUrl.href);
    }

    const projectId =
      request.headers.get('x-neon-project-id')?.trim() || null;

    return renderApprovalDialog(
      client,
      btoa(JSON.stringify(requestParams)),
      requestParams.scope,
      projectId,
    );
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const state = formData.get('state') as string;
    const selectedScopes = formData.getAll('scopes') as string[];
    const selectedPreset = formData.get('preset') as string | null;
    const protectProduction = formData.get('protect_production') === 'true';
    const projectId =
      (formData.get('project_id') as string)?.trim() || null;

    if (!state) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          error_description: 'Invalid state',
        },
        { status: 400 },
      );
    }

    // Filter to only valid scopes (read is always included via hidden input)
    const validScopes = selectedScopes.filter((s) =>
      SUPPORTED_SCOPES.includes(s as (typeof SUPPORTED_SCOPES)[number]),
    );
    if (validScopes.length === 0) {
      return NextResponse.json(
        {
          error: 'invalid_scope',
          error_description: 'No valid scopes selected',
        },
        { status: 400 },
      );
    }

    const requestParams = JSON.parse(atob(state)) as DownstreamAuthRequest;

    // Update scopes with user selection
    requestParams.scope = validScopes;

    // Build grant context from preset selection
    if (selectedPreset && PRESETS.includes(selectedPreset as Preset)) {
      // Parse scope categories for custom preset
      const selectedCategories = formData.getAll(
        'scope_categories',
      ) as string[];
      const validCategories = selectedCategories.filter((c) =>
        SCOPE_CATEGORIES.includes(c as ScopeCategory),
      ) as ScopeCategory[];

      requestParams.grant = {
        projectId,
        preset: selectedPreset as Preset,
        scopes: selectedPreset === 'custom' ? validCategories : null,
        protectedBranches: protectProduction
          ? ['main', 'master', 'prod', 'production']
          : null,
      };
    }

    await updateApprovedClientsCookie(requestParams.clientId, COOKIE_SECRET);

    // Re-encode state with updated scopes and grant
    const updatedState = btoa(JSON.stringify(requestParams));
    const authUrl = await upstreamAuth(updatedState);
    return NextResponse.redirect(authUrl.href);
  } catch (error: unknown) {
    return handleOAuthError(error, 'Authorization error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
