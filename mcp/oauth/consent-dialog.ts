import he from 'he';
import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import { SCOPE_DEFINITIONS } from '../utils/read-only';
import type { ConsentMode } from './consent-mode';
import {
  filterConsentCatalog,
  getConsentToolCatalog,
  type ConsentToolMeta,
} from './consent-tools';

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
export const COLLAPSE_ABOVE = 12;

type ConsentTool = {
  name: string;
  title: string;
  scope: ScopeCategory | null;
  writeOnly: boolean;
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
  tools: ConsentTool[];
};

type ConsentClient = {
  client_name?: string;
  client_uri?: string;
  redirect_uris?: string[];
};

type ConsentFormState = {
  projectMode: 'all' | 'one';
  projectId: string;
  categories: ScopeCategory[];
  writeChecked: boolean;
};

type ConsentDialogProps = {
  client: ConsentClient;
  state: string;
  mode: ConsentMode;
  writeChecked: boolean;
  showWriteControl: boolean;
  grant: GrantContext;
  fieldError?: { field: 'projectId'; message: string };
  formState?: ConsentFormState;
};

function formStateFromGrant({
  grant,
  writeChecked,
}: {
  grant: GrantContext;
  writeChecked: boolean;
}): ConsentFormState {
  return {
    projectMode: grant.projectId ? 'one' : 'all',
    projectId: grant.projectId ?? '',
    categories:
      grant.scopes === null ? [...SCOPE_CATEGORIES] : [...grant.scopes],
    writeChecked,
  };
}

function categoryLabels(scopes: ScopeCategory[]): string[] {
  return scopes.map((scope) => SCOPE_CATEGORY_LABELS[scope]);
}

export function buildConsentView({
  grant,
  writeChecked,
}: {
  grant: GrantContext;
  writeChecked: boolean;
}): ConsentView {
  const tools = filterConsentCatalog(
    getConsentToolCatalog(),
    grant,
    writeChecked,
  ).map((tool) => ({
    name: tool.name,
    title: tool.title,
    scope: tool.scope,
    writeOnly: tool.writeOnly,
  }));

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
    tools,
  };
}

function categoryLabelForTool(tool: ConsentToolMeta | ConsentTool): string {
  return tool.scope ? SCOPE_CATEGORY_LABELS[tool.scope] : DISCOVERY_LABEL;
}

function groupToolsByCategory(
  tools: ConsentTool[],
): { label: string; tools: ConsentTool[] }[] {
  const buckets = new Map<string, ConsentTool[]>();
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

function renderToolGroupList(tools: ConsentTool[]): string {
  if (tools.length === 0) {
    return `<p class="empty-tools">None.</p>`;
  }
  return groupToolsByCategory(tools)
    .map(
      (group) => `
        <div class="tool-group">
          <div class="tool-group-label">${he.escape(group.label)}</div>
          <ul class="tool-list">${group.tools
            .map((tool) => {
              const writeAttr = tool.writeOnly ? ' data-write-tool' : '';
              const badge = tool.writeOnly
                ? ' <span class="write-badge">write</span>'
                : '';
              return `<li${writeAttr}>${he.escape(tool.title)}${badge}</li>`;
            })
            .join('')}</ul>
        </div>`,
    )
    .join('');
}

export function visibleToolCount(view: ConsentView): number {
  return view.tools.length;
}

function toolsSummary(view: ConsentView): string {
  const count = visibleToolCount(view);
  const categories = new Set(view.tools.map(categoryLabelForTool)).size;
  const categoryWord = categories === 1 ? 'category' : 'categories';
  const mode = view.writeChecked ? 'read and write' : 'read-only';
  return `Tools · ${String(count)} in ${String(categories)} ${categoryWord} · ${mode}`;
}

function renderToolSections(view: ConsentView): string {
  if (view.tools.length === 0) {
    return `
    <section class="panel panel-tools">
      <h2>Available tools</h2>
      <p class="empty-tools">None.</p>
    </section>`;
  }
  const collapse = visibleToolCount(view) > COLLAPSE_ABOVE;
  const body = `<div class="tool-scroll" data-tool-scroll>${renderToolGroupList(view.tools)}</div>`;
  const summary = toolsSummary(view);
  const toggle = collapse
    ? `<button type="button" class="tool-toggle" data-tool-toggle aria-expanded="false">Show</button>`
    : '';
  const collapsedAttr = collapse ? ' data-tools-collapsed' : '';
  return `
    <section class="panel panel-tools">
      <h2>Available tools</h2>
      <div class="tool-block${collapse ? ' is-collapsed' : ''}" data-tools${collapsedAttr}>
        <div class="tool-block-head">
          <div class="tool-block-title" data-tools-summary>${he.escape(summary)}</div>
          ${toggle}
        </div>
        ${body}
      </div>
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

function emptyGrantNote(view: ConsentView): string {
  if (view.categories.kind !== 'none') {
    return '';
  }
  if (view.project.kind === 'one') {
    return `<p class="note">No tools are available for this connection.</p>`;
  }
  return `<p class="note">No tool categories. Search and Fetch stay available.</p>`;
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
      ${emptyGrantNote(view)}
      <p class="note">
        To change these limits, update the connection URL and authorize again.
      </p>
    </section>`;
}

function renderEditableGrant({
  formState,
  fieldError,
}: {
  formState: ConsentFormState;
  fieldError?: { field: 'projectId'; message: string };
}): string {
  const allSelected = formState.projectMode === 'all';
  const projectError =
    fieldError?.field === 'projectId'
      ? `<p class="field-error" id="project-id-error">${he.escape(fieldError.message)}</p>`
      : '';
  const invalidAttr =
    fieldError?.field === 'projectId'
      ? ' aria-invalid="true" aria-describedby="project-id-error"'
      : '';
  const categoryBoxes = SCOPE_CATEGORIES.map((category) => {
    const checked = formState.categories.includes(category) ? ' checked' : '';
    return `
      <label class="check-option">
        <input type="checkbox" name="category" value="${category}"${checked} />
        <span>${he.escape(SCOPE_CATEGORY_LABELS[category])}</span>
      </label>`;
  }).join('');

  return `
    <section class="panel">
      <h2>Connection access</h2>
      <fieldset class="choice">
        <legend>Project</legend>
        <label class="check-option">
          <input type="radio" name="projectMode" value="all"${allSelected ? ' checked' : ''} />
          <span>All projects</span>
        </label>
        <label class="check-option">
          <input type="radio" name="projectMode" value="one"${allSelected ? '' : ' checked'} />
          <span>One project</span>
        </label>
        <label class="project-id"${allSelected ? ' hidden' : ''} data-project-id-field>
          <span>Project ID</span>
          <input
            type="text"
            name="projectId"
            value="${he.escape(formState.projectId)}"
            autocomplete="off"
            spellcheck="false"
            ${allSelected ? 'disabled' : ''}
            ${invalidAttr}
          />
        </label>
        ${projectError}
        <p class="note">
          Enter a project ID the Neon account you sign in with can access.
          This page cannot list projects before you sign in.
        </p>
      </fieldset>
      <fieldset class="choice">
        <legend>Tool categories</legend>
        <div class="check-grid" data-category-grid>
          ${categoryBoxes}
        </div>
      </fieldset>
    </section>`;
}

function renderScopeSection({
  writeChecked,
  showWriteControl,
  includeReadScope,
}: {
  writeChecked: boolean;
  showWriteControl: boolean;
  includeReadScope: boolean;
}): string {
  const mode = writeChecked ? 'Read and write' : SCOPE_DEFINITIONS.read.label;
  const hiddenRead = includeReadScope
    ? '<input type="hidden" name="scopes" value="read" />'
    : '';
  if (!showWriteControl) {
    return `
    <section class="panel">
      <h2>Permissions</h2>
      <p class="access-mode" data-access-mode>${mode}</p>
      ${hiddenRead}
    </section>`;
  }

  const writeCheckedAttr = writeChecked ? 'checked' : '';
  return `
    <section class="panel">
      <h2>Permissions</h2>
      <p class="access-mode" data-access-mode>${mode}</p>
      ${hiddenRead}
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
    </section>`;
}

function consentScript(mode: ConsentMode): string {
  if (mode === 'confirmation') {
    return `
    var toolToggle = document.querySelector('[data-tool-toggle]');
    var toolBlock = document.querySelector('[data-tools]');
    if (toolToggle && toolBlock) {
      toolToggle.addEventListener('click', function () {
        var collapsed = toolBlock.classList.toggle('is-collapsed');
        toolToggle.textContent = collapsed ? 'Show' : 'Hide';
        toolToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      });
    }`;
  }

  const catalog = JSON.stringify(getConsentToolCatalog()).replace(
    /</g,
    '\\u003c',
  );
  const categories = JSON.stringify(SCOPE_CATEGORIES);
  const labels = JSON.stringify(SCOPE_CATEGORY_LABELS);
  return `
    var ALWAYS = { search: true, fetch: true };
    var CATALOG = ${catalog};
    var SCOPE_CATEGORIES = ${categories};
    var SCOPE_LABELS = ${labels};
    var DISCOVERY_LABEL = ${JSON.stringify(DISCOVERY_LABEL)};
    var COLLAPSE_ABOVE = ${String(COLLAPSE_ABOVE)};
    var userExpanded = false;

    function selectedCategories() {
      var selected = [];
      document.querySelectorAll('input[name="category"]').forEach(function (input) {
        if (input instanceof HTMLInputElement && input.checked) {
          selected.push(input.value);
        }
      });
      return selected;
    }

    function currentGrant() {
      var one = document.querySelector('input[name="projectMode"][value="one"]');
      var projectInput = document.querySelector('input[name="projectId"]');
      var projectId = null;
      if (one instanceof HTMLInputElement && one.checked && projectInput instanceof HTMLInputElement) {
        var trimmed = projectInput.value.trim();
        projectId = trimmed ? trimmed : 'pending-project';
      }
      var categories = selectedCategories();
      var scopes = null;
      if (categories.length === 0) scopes = [];
      else if (categories.length !== SCOPE_CATEGORIES.length) scopes = categories;
      return { projectId: projectId, scopes: scopes };
    }

    function writeChecked() {
      var box = document.querySelector('.scope-checkbox');
      return !!(box && box.checked);
    }

    function filterCatalog(grant, checked) {
      return CATALOG.filter(function (tool) {
        if (!checked && tool.writeOnly) return false;
        if (grant.projectId && !tool.projectScoped) return false;
        if (grant.scopes === null) return true;
        if (grant.scopes.length === 0) return !!ALWAYS[tool.name];
        if (ALWAYS[tool.name]) return true;
        if (!tool.scope) return true;
        return grant.scopes.indexOf(tool.scope) !== -1;
      });
    }

    function categoryLabel(tool) {
      return tool.scope ? SCOPE_LABELS[tool.scope] : DISCOVERY_LABEL;
    }

    function renderTools(tools) {
      var scroll = document.querySelector('[data-tool-scroll]');
      if (!scroll) return;
      if (tools.length === 0) {
        scroll.innerHTML = '<p class="empty-tools">None.</p>';
        return;
      }
      var order = [DISCOVERY_LABEL].concat(SCOPE_CATEGORIES.map(function (id) { return SCOPE_LABELS[id]; }));
      var buckets = {};
      tools.forEach(function (tool) {
        var label = categoryLabel(tool);
        if (!buckets[label]) buckets[label] = [];
        buckets[label].push(tool);
      });
      scroll.innerHTML = order.map(function (label) {
        var group = buckets[label];
        if (!group) return '';
        return '<div class="tool-group"><div class="tool-group-label">' + label + '</div><ul class="tool-list">' +
          group.map(function (tool) {
            var writeAttr = tool.writeOnly ? ' data-write-tool' : '';
            var badge = tool.writeOnly ? ' <span class="write-badge">write</span>' : '';
            return '<li' + writeAttr + '>' + tool.title + badge + '</li>';
          }).join('') + '</ul></div>';
      }).join('');
    }

    function toolsSummaryText(tools, checked) {
      var categories = {};
      tools.forEach(function (tool) { categories[categoryLabel(tool)] = true; });
      var count = Object.keys(categories).length;
      var categoryWord = count === 1 ? 'category' : 'categories';
      var mode = checked ? 'read and write' : 'read-only';
      return 'Tools · ' + tools.length + ' in ' + count + ' ' + categoryWord + ' · ' + mode;
    }

    function syncProjectField() {
      var one = document.querySelector('input[name="projectMode"][value="one"]');
      var field = document.querySelector('[data-project-id-field]');
      var input = document.querySelector('input[name="projectId"]');
      if (!(one instanceof HTMLInputElement) || !field) return;
      field.hidden = !one.checked;
      if (input instanceof HTMLInputElement) {
        input.disabled = !one.checked;
      }
    }

    function syncConsentUi() {
      syncProjectField();
      var grant = currentGrant();
      var checked = writeChecked();
      var tools = filterCatalog(grant, checked);
      var mode = document.querySelector('[data-access-mode]');
      if (mode) mode.textContent = checked ? 'Read and write' : 'Read-only';
      var summary = document.querySelector('[data-tools-summary]');
      if (summary) summary.textContent = toolsSummaryText(tools, checked);
      renderTools(tools);
      var toolBlock = document.querySelector('[data-tools]');
      var toolToggle = document.querySelector('[data-tool-toggle]');
      var collapse = tools.length > COLLAPSE_ABOVE;
      if (toolBlock) {
        if (!collapse) {
          toolBlock.classList.remove('is-collapsed');
          userExpanded = false;
        } else if (!userExpanded) {
          toolBlock.classList.add('is-collapsed');
        }
      }
      if (toolToggle) {
        if (!collapse) {
          toolToggle.hidden = true;
        } else {
          toolToggle.hidden = false;
          var collapsed = toolBlock ? toolBlock.classList.contains('is-collapsed') : true;
          toolToggle.textContent = collapsed ? 'Show' : 'Hide';
          toolToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
      }
    }

    document.querySelectorAll('input[name="projectMode"], input[name="projectId"], input[name="category"], .scope-checkbox').forEach(function (input) {
      input.addEventListener('change', syncConsentUi);
      input.addEventListener('input', syncConsentUi);
    });
    var toolToggle = document.querySelector('[data-tool-toggle]');
    var toolBlock = document.querySelector('[data-tools]');
    if (toolToggle && toolBlock) {
      toolToggle.addEventListener('click', function () {
        var collapsed = toolBlock.classList.toggle('is-collapsed');
        userExpanded = !collapsed;
        toolToggle.textContent = collapsed ? 'Show' : 'Hide';
        toolToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      });
    }
    syncConsentUi();`;
}

export function renderConsentHtml(props: ConsentDialogProps): string {
  const formState =
    props.formState ??
    formStateFromGrant({
      grant: props.grant,
      writeChecked: props.writeChecked,
    });
  const previewGrant =
    props.mode === 'editable'
      ? {
          projectId:
            formState.projectMode === 'one'
              ? formState.projectId.trim() || null
              : null,
          scopes:
            formState.categories.length === 0
              ? []
              : formState.categories.length === SCOPE_CATEGORIES.length
                ? null
                : formState.categories,
          unknownCategories: props.grant.unknownCategories,
        }
      : props.grant;
  const view = buildConsentView({
    grant: previewGrant,
    writeChecked: formState.writeChecked,
  });
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
  const grantHtml =
    props.mode === 'confirmation'
      ? renderGrantSummary(view)
      : renderEditableGrant({
          formState,
          fieldError: props.fieldError,
        });

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
      --danger: #ff7d87;
    }

    * { box-sizing: border-box; }

    html {
      min-height: 100%;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
        Arial, sans-serif;
      line-height: 1.45;
      color: var(--text);
      background: var(--bg);
    }

    /* Class display rules otherwise override the hidden attribute. */
    [hidden] {
      display: none !important;
    }

    .page {
      max-width: 36rem;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 1.5rem;
    }

    .brand {
      display: block;
      width: 2rem;
      height: 2rem;
      margin-bottom: 1rem;
    }

    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.35rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      overflow-wrap: anywhere;
    }

    h2, legend {
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
      margin-bottom: 1rem;
      overflow-wrap: anywhere;
    }

    .client-meta {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      margin-top: 0.35rem;
      font-size: 0.8rem;
      color: var(--muted);
      overflow-wrap: anywhere;
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

    .panel, .choice {
      padding: 1.1rem 0;
      border-top: 1px solid var(--line);
    }

    .card-main .panel:first-of-type,
    .card-main .choice:first-of-type {
      border-top: 0;
      padding-top: 0.25rem;
    }

    fieldset.choice {
      margin: 0;
      border: 0;
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
      overflow-wrap: anywhere;
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }

    .note, .field-error {
      color: var(--muted);
      font-size: 0.8rem;
      margin: 0.75rem 0 0;
    }

    .field-error {
      color: var(--danger);
    }

    .access-mode {
      margin: 0 0 0.75rem;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .write-option, .check-option {
      display: flex;
      gap: 0.7rem;
      align-items: flex-start;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      cursor: pointer;
    }

    .write-option:hover, .check-option:hover {
      border-color: rgba(0, 229, 153, 0.45);
    }

    .check-grid {
      display: grid;
      gap: 0.45rem;
    }

    .scope-checkbox, .check-option input, .choice input[type="radio"] {
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

    .project-id {
      display: grid;
      gap: 0.35rem;
      margin-top: 0.75rem;
      font-size: 0.85rem;
    }

    .project-id input {
      width: 100%;
      padding: 0.55rem 0.65rem;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--text);
      font: inherit;
    }

    .tool-block-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.45rem;
    }

    .tool-block-title {
      font-size: 0.85rem;
      font-weight: 600;
    }

    .tool-toggle {
      background: none;
      border: 0;
      padding: 0;
      color: var(--muted);
      font: inherit;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
    }

    .tool-scroll {
      max-height: 16rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.1rem 0.4rem 0.35rem 0;
      scrollbar-width: thin;
      scrollbar-color: var(--line) transparent;
    }

    .tool-block.is-collapsed .tool-scroll {
      display: none;
    }

    .write-badge {
      margin-left: 0.35rem;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
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
      margin: 1rem 0 0;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
      margin: 0.85rem 0 0.75rem;
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
      <div class="card-main">
      ${grantHtml}
      ${renderScopeSection({
        writeChecked: formState.writeChecked,
        showWriteControl: props.showWriteControl,
        includeReadScope: props.mode === 'editable',
      })}
      </div>
      ${renderToolSections(view)}
      <div class="card-foot">
      <p class="next-step">
        Next, you will sign in to Neon. That step does not use the project,
        category, or write limits above.
      </p>
      <div class="actions">
        <button type="submit" class="button button-secondary" name="action" value="cancel" formnovalidate>Cancel</button>
        <button type="submit" class="button button-primary" name="action" value="approve">Approve and continue to Neon</button>
      </div>
      </div>
    </form>
  </div>
  <script>
    ${consentScript(props.mode)}
  </script>
</body>
</html>`;
}
