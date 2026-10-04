import he from 'he';
import { SCOPE_DEFINITIONS } from '../utils/read-only';
import {
  SCOPE_CATEGORIES,
  type GrantContext,
  type ScopeCategory,
} from '../utils/grant-context';
import type { ConsentMode } from './consent-mode';
import { ALWAYS_AVAILABLE_TOOLS } from '../tools/grant-filter';
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
export const COLLAPSE_ABOVE = 4;

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

function urlSummary(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function renderClientVerification(client: ConsentClient): string {
  const website = client.client_uri;
  const redirects = client.redirect_uris ?? [];
  if (!website && redirects.length === 0) {
    return '';
  }

  let summary = website ? urlSummary(website) : '';
  if (redirects.length === 1) {
    const redirect = urlSummary(redirects[0]);
    summary = website ? `${summary} → ${redirect}` : `Redirects to ${redirect}`;
  } else if (redirects.length > 1) {
    const redirectHosts = [...new Set(redirects.map(urlSummary))].join(', ');
    summary = website
      ? `${summary} → ${redirectHosts}`
      : `Redirects to ${redirectHosts}`;
  }
  const websiteHtml = website
    ? `
        <div>
          <dt>App website</dt>
          <dd>${
            isWebUrl(website)
              ? `<a href="${he.escape(website)}" target="_blank" rel="noopener noreferrer">${he.escape(website)}</a>`
              : `<span class="mono">${he.escape(website)}</span>`
          }</dd>
        </div>`
    : '';
  const redirectHtml =
    redirects.length > 0
      ? `
        <div>
          <dt>${redirects.length === 1 ? 'Redirect URI' : 'Redirect URIs'}</dt>
          <dd class="client-uris">${redirects
            .map((uri) => `<span class="mono">${he.escape(uri)}</span>`)
            .join('')}</dd>
        </div>`
      : '';

  return `
    <details class="client-verify">
      <summary><span class="app-details-title">App details</span><span class="client-summary">${he.escape(summary)}</span></summary>
      <dl class="client-meta">
        ${websiteHtml}
        ${redirectHtml}
      </dl>
    </details>`;
}

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
  return `${String(count)} ${count === 1 ? 'tool' : 'tools'} available`;
}

function renderToolSections(view: ConsentView, interactive: boolean): string {
  const collapse = visibleToolCount(view) > COLLAPSE_ABOVE;
  return `
    <section class="panel panel-tools" aria-label="Included tools">
      <div class="tool-block${collapse ? ' is-collapsed' : ''}" data-tools>
        <div class="tool-block-head">
          <button type="button" class="tool-toggle" data-tool-toggle aria-controls="available-tools-content" aria-expanded="${!collapse}">Included tools</button>
          ${interactive ? '' : `<span class="tool-block-title" data-tools-summary>${toolsSummary(view)}</span>`}
        </div>
        <div class="tool-content" id="available-tools-content" data-tool-content>${renderToolGroupList(view.tools)}</div>
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
    return `<p class="note">No tool categories. Send Feedback stays available.</p>`;
  }
  return `<p class="note">No tool categories. Search, Fetch, and Send Feedback stay available.</p>`;
}

function renderGrantSummary(view: ConsentView): string {
  const projectValue =
    view.project.kind === 'one'
      ? `<span class="mono">${renderProject(view.project)}</span>`
      : renderProject(view.project);

  const unknownHtml =
    view.unknownCategoryValues.length > 0
      ? `<p class="warning" role="status">Unsupported categories will not be granted: ${he.escape(
          view.unknownCategoryValues.join(', '),
        )}.</p>`
      : '';

  return `
    <section class="panel panel-requested">
      <h2>Requested access</h2>
      <dl class="facts">
        <div>
          <dt>Project:</dt>
          <dd>${projectValue}</dd>
        </div>
        <div>
          <dt>Tool categories:</dt>
          <dd>${he.escape(renderCategories(view.categories))}</dd>
        </div>
      </dl>
      ${unknownHtml}
      ${emptyGrantNote(view)}
      <p class="note connection-note">
        <img src="/images/consent/info-outline.svg" alt="" width="18" height="18">
        To change this access, update the connection URL and authorize again.
      </p>
    </section>`;
}

function categorySelectionSummary(categories: ScopeCategory[]): string {
  return `${String(categories.length)}/${String(SCOPE_CATEGORIES.length)} selected`;
}

function renderEditableGrant({
  formState,
  fieldError,
  view,
}: {
  view: ConsentView;
  formState: ConsentFormState;
  fieldError?: { field: 'projectId'; message: string };
}): string {
  const allSelected = formState.projectMode === 'all';
  const projectError =
    fieldError?.field === 'projectId'
      ? `<p class="field-error" id="project-id-error" role="alert">${he.escape(fieldError.message)}</p>`
      : '';
  const invalidAttr =
    fieldError?.field === 'projectId'
      ? ' aria-invalid="true" aria-describedby="project-id-error" autofocus'
      : '';
  const displayCategories = [
    'projects',
    'endpoints',
    'schema',
    'neon_auth',
    'observability',
    'functions',
    'branches',
    'snapshots',
    'querying',
    'data_api',
    'docs',
    'storage',
  ] satisfies ScopeCategory[];
  const categoryBoxes = displayCategories
    .map((category) => {
      const checked = formState.categories.includes(category) ? ' checked' : '';
      return `
      <label class="check-option">
        <input type="checkbox" name="category" value="${category}"${checked} />
        <span>${he.escape(SCOPE_CATEGORY_LABELS[category])}</span>
      </label>`;
    })
    .join('');

  return `
    <section class="panel panel-access">
      <h2>Choose access</h2>
      <fieldset class="choice">
        <legend>Project</legend>
        <label class="check-option">
          <input type="radio" name="projectMode" value="all"${allSelected ? ' checked' : ''} />
          <span>All projects you can access</span>
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
        <p class="note" data-project-id-help${allSelected ? ' hidden' : ''}>
          Enter a project ID the Neon account you sign in with can access.
          This page cannot list projects before you sign in.
        </p>
      </fieldset>
      <details class="choice choice-categories" data-category-disclosure>
        <summary class="category-disclosure-summary">
          <span class="choice-title">Tool categories</span>
          <span class="category-summary" data-category-summary>${categorySelectionSummary(formState.categories)} · ${toolsSummary(view)}</span>
        </summary>
        <div class="category-disclosure-body">
          <div class="choice-actions">
            <button type="button" class="choice-action" data-category-select-all>Select all</button>
            <button type="button" class="choice-action" data-category-clear-all>Clear all</button>
          </div>
          <div class="check-grid" data-category-grid role="group" aria-label="Tool categories">
            ${categoryBoxes}
          </div>
          ${renderToolSections(view, true)}
        </div>
      </details>
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
  const mode = writeChecked ? 'Read and write' : 'Read only';
  const hiddenReadDisabled =
    showWriteControl && !writeChecked ? ' disabled' : '';
  const hiddenRead = includeReadScope
    ? `<input type="hidden" name="scopes" value="read"${hiddenReadDisabled} />`
    : '';
  if (!showWriteControl) {
    return `
    <section class="panel panel-permissions">
      <h2>Permissions</h2>
      <p class="access-mode" data-access-mode data-write-enabled="${writeChecked}">${mode}</p>
      ${hiddenRead}
    </section>`;
  }

  return `
    <section class="panel panel-permissions">
      <fieldset class="permission-options">
        <legend>Permissions</legend>
        <p class="sr-only" data-access-mode data-write-enabled="${writeChecked}" aria-live="polite">${mode}</p>
        ${hiddenRead}
        <label class="check-option">
          <input type="radio" name="scopes" value="read" ${writeChecked ? '' : 'checked'} />
          <span>Read only</span>
        </label>
        <div class="write-row">
          <label class="check-option">
            <input type="radio" name="scopes" value="write" class="scope-checkbox" ${writeChecked ? 'checked' : ''} aria-describedby="write-help" />
            <span>Read and write</span>
          </label>
          <span class="write-info">
            <button type="button" class="info-button" aria-label="About write permissions" aria-describedby="write-help"><img src="/images/consent/info-outline.svg" alt="" width="18" height="18"></button>
            <span class="write-help" id="write-help" role="tooltip">${he.escape(SCOPE_DEFINITIONS.write.description)}</span>
          </span>
        </div>
      </fieldset>
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
  // Built from the server list so the live preview cannot drift from it.
  const always = JSON.stringify(
    Object.fromEntries([...ALWAYS_AVAILABLE_TOOLS].map((name) => [name, true])),
  );
  return `
    var ALWAYS = ${always};
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
      var content = document.querySelector('[data-tool-content]');
      if (!content) return;
      if (tools.length === 0) {
        content.innerHTML = '<p class="empty-tools">None.</p>';
        return;
      }
      var order = [DISCOVERY_LABEL].concat(SCOPE_CATEGORIES.map(function (id) { return SCOPE_LABELS[id]; }));
      var buckets = {};
      tools.forEach(function (tool) {
        var label = categoryLabel(tool);
        if (!buckets[label]) buckets[label] = [];
        buckets[label].push(tool);
      });
      content.innerHTML = order.map(function (label) {
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

    function toolsSummaryText(tools) {
      return tools.length + ' ' + (tools.length === 1 ? 'tool' : 'tools') + ' available';
    }

    function categorySummaryText(categories) {
      return categories.length + '/' + SCOPE_CATEGORIES.length + ' selected';
    }

    function syncProjectField() {
      var one = document.querySelector('input[name="projectMode"][value="one"]');
      var field = document.querySelector('[data-project-id-field]');
      var help = document.querySelector('[data-project-id-help]');
      var input = document.querySelector('input[name="projectId"]');
      if (!(one instanceof HTMLInputElement) || !field) return;
      field.hidden = !one.checked;
      if (help) help.hidden = !one.checked;
      if (input instanceof HTMLInputElement) {
        input.disabled = !one.checked;
      }
    }

    function syncConsentUi() {
      syncProjectField();
      var grant = currentGrant();
      var checked = writeChecked();
      var writeControl = document.querySelector('.scope-checkbox');
      var hiddenRead = document.querySelector('input[type="hidden"][name="scopes"][value="read"]');
      if (
        writeControl instanceof HTMLInputElement &&
        hiddenRead instanceof HTMLInputElement
      ) {
        hiddenRead.disabled = !checked;
      }
      var tools = filterCatalog(grant, checked);
      var categorySummary = document.querySelector('[data-category-summary]');
      if (categorySummary) {
        categorySummary.textContent = categorySummaryText(selectedCategories()) + ' · ' + toolsSummaryText(tools);
      }
      var mode = document.querySelector('[data-access-mode]');
      if (mode) {
        mode.textContent = checked ? 'Read and write' : 'Read only';
        mode.setAttribute('data-write-enabled', String(checked));
      }
      var summary = document.querySelector('[data-tools-summary]');
      if (summary) summary.textContent = toolsSummaryText(tools);
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
        var collapsed = toolBlock ? toolBlock.classList.contains('is-collapsed') : true;
        toolToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    }

    var consentForm = document.getElementById('authorize-form');
    var projectIdInput = document.querySelector('input[name="projectId"]');
    var approveButton = document.querySelector('button[value="approve"]');
    if (consentForm instanceof HTMLFormElement &&
        projectIdInput instanceof HTMLInputElement &&
        approveButton instanceof HTMLButtonElement) {
      projectIdInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          consentForm.requestSubmit(approveButton);
        }
      });
    }

    document.querySelectorAll('input[name="projectMode"], input[name="projectId"], input[name="category"], input[type="radio"][name="scopes"]').forEach(function (input) {
      input.addEventListener('change', syncConsentUi);
      input.addEventListener('input', syncConsentUi);
    });
    var categoryDisclosure = document.querySelector('[data-category-disclosure]');
    if (categoryDisclosure instanceof HTMLDetailsElement) {
      categoryDisclosure.addEventListener('toggle', function () {
        if (!categoryDisclosure.open) return;
        var firstCategory = categoryDisclosure.querySelector('input[name="category"]');
        if (firstCategory instanceof HTMLInputElement) {
          firstCategory.scrollIntoView({ block: 'nearest' });
        }
      });
    }
    var toolToggle = document.querySelector('[data-tool-toggle]');
    var toolBlock = document.querySelector('[data-tools]');
    if (toolToggle && toolBlock) {
      toolToggle.addEventListener('click', function () {
        var collapsed = toolBlock.classList.toggle('is-collapsed');
        userExpanded = !collapsed;

        toolToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      });
    }
    var selectAllCategories = document.querySelector('[data-category-select-all]');
    var clearAllCategories = document.querySelector('[data-category-clear-all]');
    if (selectAllCategories) {
      selectAllCategories.addEventListener('click', function () {
        document.querySelectorAll('input[name="category"]').forEach(function (input) {
          if (input instanceof HTMLInputElement) input.checked = true;
        });
        syncConsentUi();
      });
    }
    if (clearAllCategories) {
      clearAllCategories.addEventListener('click', function () {
        document.querySelectorAll('input[name="category"]').forEach(function (input) {
          if (input instanceof HTMLInputElement) input.checked = false;
        });
        syncConsentUi();
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
  const clientVerification = renderClientVerification(client);
  const grantHtml =
    props.mode === 'confirmation'
      ? renderGrantSummary(view)
      : renderEditableGrant({
          formState,
          fieldError: props.fieldError,
          view,
        });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect ${clientName} to Neon</title>
  <link rel="preload" href="/fonts/inter/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/fonts/inter/inter.css">
  <style>
    :root {
      color-scheme: dark;
      --text: #e4e5e7;
      --muted: #94979e;
      --bg: #000;
      --card: #0c0d0d;
      --line: #303236;
      --green: #34d59a;
      --danger: #ff7d87;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 15px;
      line-height: 1.375;
      letter-spacing: -0.02em;
      color: var(--text);
      background: var(--bg);
    }
    [hidden] { display: none !important; }
    button, input { font: inherit; letter-spacing: inherit; }
    button, summary, label { -webkit-tap-highlight-color: transparent; }
    button { cursor: pointer; }
    :is(button, input, summary, a):focus-visible {
      outline: 2px solid var(--green);
      outline-offset: 4px;
    }
    .page {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      height: 100vh;
      height: 100dvh;
      padding: 80px 24px;
      overflow: clip;
    }
    .card {
      display: flex;
      flex-direction: column;
      width: 651px;
      max-width: 100%;
      max-height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--card);
      border: 1px solid var(--line);
    }
    .consent-header {
      flex: 0 0 auto;
      padding: 32px 28px 28px;
      border-bottom: 1px solid var(--line);
    }
    .connection-icons { display: flex; align-items: center; gap: 2.44px; height: 40px; margin-bottom: 16px; }
    .client-icon { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid #61646b; border-radius: 50%; }
    .connection-line { display: block; width: 22px; height: 2px; }
    .brand { width: 40px; height: 40px; }
    h1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin: 0; font-size: 24px; line-height: 1.375; font-weight: 400; letter-spacing: -0.02em; color: #fff; overflow-wrap: anywhere; }
    h2, .app-details-title, .permission-options legend { display: block; margin: 0 0 16px; padding: 0; font-size: 20px; font-weight: 400; }
    h3, .choice legend, .choice-title { margin: 0 0 16px; padding: 0; font-size: 18px; font-weight: 400; }
    .panel-requested h3 { margin-bottom: 20px; }
    .panel-permissions h2 { margin-bottom: 10px; }
    .card-body {
      min-height: 0;
      min-width: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 28px;
      scrollbar-width: thin;
      scrollbar-color: #494b50 transparent;
    }
    .card-body:focus-visible { outline: 1px solid var(--green); outline-offset: -1px; }
    .client-verify { padding: 24px 0 20px; border-bottom: 1px solid var(--line); }
    summary { cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .app-details-title { margin-bottom: 6px; }
    .client-summary { display: block; color: var(--muted); overflow-wrap: anywhere; }
    .client-meta { display: grid; gap: 12px; margin: 20px 0 0; font-size: 15px; }
    .client-meta > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; }
    .client-uris { display: flex; flex-direction: column; gap: 8px; }
    .client-meta a { color: var(--text); text-underline-offset: 3px; }
    .panel { padding: 20px 0; border-bottom: 1px solid var(--line); }
    .panel-permissions { border-bottom: 0; padding-bottom: 28px; }
    .panel-requested { border-bottom-style: dashed; }
    .choice, .permission-options { min-width: 0; margin: 0; padding: 0; border: 0; }
    .check-option { display: flex; align-items: center; gap: 10px; width: fit-content; min-height: 21px; cursor: pointer; }
    .choice > .check-option + .check-option, .write-row { margin-top: 12px; }
    .check-option input { appearance: none; flex-shrink: 0; width: 16px; height: 16px; margin: 0; border: 1px solid #494b50; background: #000; cursor: pointer; }
    .check-option input[type="radio"] { border-radius: 50%; }
    .check-option input[type="radio"]:checked { border: 4px solid #39a57d; background: var(--card); }
    .check-option input[type="checkbox"]:checked { border-color: #39a57d; background: #39a57d url('/images/consent/check.svg') center / 12px 12px no-repeat; }
    .check-option:hover { color: #fff; }
    .project-id { display: grid; gap: 8px; margin-top: 16px; }
    .project-id input { min-width: 0; width: 100%; height: 44px; padding: 11px 16px; border: 1px solid var(--line); border-radius: 0; background: var(--card); color: #fff; font-size: 16px; }
    .project-id input[aria-invalid="true"] { border-color: var(--danger); }
    .note, .field-error, .warning { color: var(--muted); font-size: 15px; margin: 8px 0 0; }
    .note[data-project-id-help] { font-size: 14px; }
    .field-error { color: var(--danger); }
    .warning { padding: 12px; border: 1px solid var(--danger); }
    .choice-categories { margin-top: 20px; padding-top: 20px; border-top: 1px dashed var(--line); }
    .category-disclosure-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .category-disclosure-summary .choice-title { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; margin: 0; }
    .choice-title::after, .tool-toggle::after { content: ''; display: block; width: 20px; height: 20px; background: url('/images/consent/chevron.svg') center / contain no-repeat; }
    .choice-categories[open] .choice-title::after, .tool-toggle[aria-expanded="true"]::after { transform: rotate(180deg); }
    .category-summary, .tool-block-title { color: var(--muted); font-size: 15px; text-align: right; }
    .category-disclosure-body { padding-top: 20px; }
    .choice-actions { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .choice-action { border: 0; padding: 0; background: transparent; color: var(--green); font-size: 15px; }
    .choice-action + .choice-action { padding-left: 12px; border-left: 1px solid var(--line); }
    .choice-action:hover { color: #fff; }
    .check-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(4, auto); grid-auto-flow: column; gap: 12px 32px; }
    .check-grid .check-option { min-width: 0; }
    .facts { display: grid; gap: 12px; margin: 0; }
    .facts > div { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 32px; }
    dt, dd { margin: 0; overflow-wrap: anywhere; }
    dt { color: var(--muted); }
    .mono { overflow-wrap: anywhere; }
    .connection-note { display: flex; align-items: flex-start; gap: 8px; padding: 12px 40px 12px 12px; margin-top: 28px; border: 1px solid var(--line); background: #18191b; }
    .connection-note img { flex-shrink: 0; margin-top: 1px; }
    .panel-tools { padding: 20px 0; border-bottom: 1px solid var(--line); }
    .choice-categories .panel-tools { padding: 20px 0 0; border: 0; }
    .tool-block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .tool-toggle { display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: transparent; color: var(--text); font-size: 18px; }
    .choice-categories .tool-toggle { font-size: 16px; }
    .tool-block.is-collapsed .tool-content { display: none; }
    .tool-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 28px; margin-top: 28px; }
    .choice-categories .tool-content { margin-top: 20px; column-gap: 24px; }
    .tool-group { min-width: 0; overflow-wrap: anywhere; }
    .choice-categories .tool-list { gap: 10px; }
    .tool-group-label { color: var(--muted); margin-bottom: 12px; }
    .tool-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
    .write-badge { margin-left: 6px; color: var(--muted); font-size: 12px; }
    .empty-tools { margin: 16px 0 0; color: var(--muted); }
    .access-mode { margin: 0; color: var(--muted); }
    .write-row { display: flex; align-items: center; gap: 6px; }
    .write-info { position: relative; display: flex; }
    .info-button { display: flex; padding: 0; border: 0; background: none; }
    .write-help { position: absolute; z-index: 2; left: -24px; bottom: 28px; width: 309px; max-width: 52vw; padding: 16px; border: 1px solid var(--line); background: #18191b; color: var(--muted); visibility: hidden; }
    .write-info:hover .write-help, .write-info:focus-within .write-help { visibility: visible; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .card-foot { flex: 0 0 auto; padding: 19px 28px; border-top: 1px solid var(--line); background: var(--card); }
    .actions { display: flex; justify-content: flex-end; gap: 12px; }
    .button { width: 152px; height: 40px; padding: 0 20px; border-radius: 33px; font-size: 16px; line-height: 1; font-weight: 500; }
    .button-primary { border: 1px solid #fff; background: #fff; color: #000; }
    .button-primary:hover { background: #e4e5e7; border-color: #e4e5e7; }
    .button-secondary { border: 1px solid #61646b; background: rgba(255,255,255,0.02); color: #fff; }
    .button-secondary:hover { border-color: var(--text); }
    @media (max-width: 600px) {
      .page { padding: 56px 16px; }
      .consent-header { padding: 24px 20px; }
      h1 { font-size: 24px; }
      .card-body { padding: 0 20px; }
      h2, .app-details-title, .permission-options legend { font-size: 20px; }
      h3, .choice legend, .choice-title, .tool-toggle { font-size: 18px; }
      .category-disclosure-summary { flex-wrap: wrap; gap: 8px; }
      .category-summary { font-size: 13px; text-align: left; }
      .card-foot { padding: 16px 20px; }
      .button { flex: 1; max-width: 152px; width: auto; }
      .check-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(6, auto); gap: 12px 16px; }
      .facts > div { grid-template-columns: 38% minmax(0, 1fr); gap: 12px; }
      .tool-content { grid-template-columns: 1fr; }
      .client-meta > div { grid-template-columns: 1fr; gap: 4px; }
      .write-help { left: -140px; max-width: 240px; }
    }
    @media (max-width: 380px) {
      .check-grid { grid-template-columns: 1fr; grid-template-rows: none; grid-auto-flow: row; }
    }
    @media (max-height: 520px) {
      .page { overflow-y: auto; padding-right: 8px; padding-left: 8px; }
      .card { max-height: none; }
      .card-body { flex-shrink: 0; overflow: visible; }
      .consent-header { padding: 16px 20px; }
      .connection-icons { height: 32px; margin-bottom: 12px; }
      .client-icon { width: 32px; height: 32px; }
      .brand { width: 28px; height: 28px; }
      h1 { font-size: 22px; }
      .card-foot { padding: 12px 20px; }
    }
    @media (forced-colors: active) {
      .check-option input { appearance: auto; }
    }
  </style>
</head>
<body>
  <div class="page">
    <form method="POST" action="/api/authorize" id="authorize-form" class="card">
      <input type="hidden" name="state" value="${he.escape(props.state)}" />
      <header class="consent-header">
        <div class="connection-icons" aria-hidden="true">
          <span class="client-icon"><img src="/images/consent/key.svg" alt="" width="18" height="18"></span>
          <img class="connection-line" src="/images/consent/dash.svg" alt="" width="22" height="2">
          <img class="brand" src="/images/consent/neon.svg" alt="" width="40" height="40">
        </div>
        <h1 title="Connect ${clientName} to Neon">Connect ${clientName} to Neon</h1>
      </header>
      <div class="card-body" tabindex="0" role="region" aria-label="Connection access details">
      ${clientVerification}
      ${grantHtml}
      ${props.mode === 'confirmation' ? renderToolSections(view, false) : ''}
      ${renderScopeSection({
        writeChecked: formState.writeChecked,
        showWriteControl: props.showWriteControl,
        includeReadScope: props.mode === 'editable',
      })}
      </div>
      <div class="card-foot">
      <div class="actions">
        <button type="submit" class="button button-secondary" name="action" value="cancel" formnovalidate>Cancel</button>
        <button type="submit" class="button button-primary" name="action" value="approve">Approve</button>
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
