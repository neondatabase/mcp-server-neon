'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  SCOPE_CATEGORIES,
  type ScopeCategory,
} from '../../../mcp-src/utils/grant-context';
import { SCOPE_CATEGORY_DISPLAY } from '../../../mcp-src/utils/scope-category-display';
import { approveConsent, cancelConsent } from './actions';
import type { ConsentFormProps } from './types';

type ToolPreviewItem = {
  name: string;
  title: string;
  scope: ScopeCategory | 'global';
  readOnlySafe: boolean;
};

type ListToolsResponse = {
  tools: ToolPreviewItem[];
  notices?: string[];
  warnings?: string[];
};

const PREVIEW_DEBOUNCE_MS = 250;

const buildPreviewQuery = ({
  selectedAll,
  categories,
  projectId,
  readOnly,
}: {
  selectedAll: boolean;
  categories: Set<ScopeCategory>;
  projectId: string | null;
  readOnly: boolean;
}): string => {
  const params = new URLSearchParams();
  if (!selectedAll && categories.size > 0) {
    for (const c of categories) params.append('category', c);
  } else if (!selectedAll && categories.size === 0) {
    // Tell the API "I explicitly picked zero categories" so the response
    // shows only the always-available tools (search/fetch). The API
    // filters unrecognized category values out, leaving the empty set;
    // sending no `category=` param at all would be interpreted as
    // "unconstrained" and would return every tool.
    params.append('category', '__none__');
  }
  if (projectId && projectId.trim().length > 0) {
    params.set('projectId', projectId.trim());
  }
  params.set('readonly', String(readOnly));
  return params.toString();
};

export function ConsentForm({
  signedState,
  client,
  initial,
  locks,
}: ConsentFormProps) {
  const formId = useId();
  const projectIdInputId = useId();

  const initialCategorySet = useMemo<Set<ScopeCategory>>(() => {
    if (initial.categories === null) return new Set(SCOPE_CATEGORIES);
    return new Set(initial.categories);
  }, [initial.categories]);

  const [readOnly, setReadOnly] = useState<boolean>(initial.readOnly);
  const [projectId, setProjectId] = useState<string>(initial.projectId ?? '');
  const [categories, setCategories] =
    useState<Set<ScopeCategory>>(initialCategorySet);
  const [selectedAll, setSelectedAll] = useState<boolean>(
    initial.categories === null,
  );
  const [submitting, setSubmitting] = useState<'approve' | 'cancel' | null>(
    null,
  );

  // Categories the user is allowed to choose from. When the MCP client
  // capped the set via its resource URI, we render only that subset.
  const allowedCategories = useMemo<ScopeCategory[]>(() => {
    if (locks.categoriesLockedToSubsetOf === null) return [...SCOPE_CATEGORIES];
    const allowed = new Set<ScopeCategory>(locks.categoriesLockedToSubsetOf);
    return SCOPE_CATEGORIES.filter((c) => allowed.has(c));
  }, [locks.categoriesLockedToSubsetOf]);

  const [preview, setPreview] = useState<{
    loading: boolean;
    error: string | null;
    data: ListToolsResponse | null;
  }>({ loading: true, error: null, data: null });

  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(() => {
      const query = buildPreviewQuery({
        selectedAll,
        categories,
        projectId: projectId || null,
        readOnly,
      });
      setPreview((prev) => ({ ...prev, loading: true, error: null }));
      fetch(`/api/list-tools?${query}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Preview failed (HTTP ${res.status})`);
          }
          const data = (await res.json()) as ListToolsResponse;
          setPreview({ loading: false, error: null, data });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            err instanceof Error ? err.message : 'Failed to load preview';
          setPreview({ loading: false, error: message, data: null });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [selectedAll, categories, projectId, readOnly]);

  const toggleCategory = (cat: ScopeCategory) => {
    setSelectedAll(false);
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedAll(true);
    setCategories(new Set(allowedCategories));
  };

  const handleClearAll = () => {
    setSelectedAll(false);
    setCategories(new Set());
  };

  const previewTools = preview.data?.tools ?? [];
  const previewCount = previewTools.length;

  return (
    <div className="min-h-screen bg-neon-surface text-neon-text">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <BrandHeader />

        <form
          id={formId}
          action={approveConsent}
          onSubmit={() => setSubmitting('approve')}
          className="rounded-2xl border border-neon-border bg-neon-surface-elevated p-6 shadow-[0_0_60px_-30px_rgba(0,229,153,0.55)] sm:p-9"
        >
          <input type="hidden" name="signedState" value={signedState} />
          <input type="hidden" name="readonly" value={String(readOnly)} />
          <input
            type="hidden"
            name="categoriesAll"
            value={String(selectedAll)}
          />
          {[...categories].map((c) => (
            <input key={c} type="hidden" name="categories" value={c} />
          ))}

          <header className="mb-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-neon-text-muted">
              Authorization request
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              Allow <span className="text-neon-green">{client.name}</span> to
              access your Neon resources
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neon-text-muted">
              Review and adjust the access below, then approve to continue. You
              can sign out any time from the Neon console to revoke this
              authorization.
            </p>
          </header>

          <ClientInfoCard client={client} />

          <Section
            label="01"
            title="Access mode"
            description="How much can the agent do on your behalf? Read-only is the safer default."
          >
            <div
              role="radiogroup"
              aria-label="Access mode"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              <AccessModeOption
                checked={readOnly}
                onSelect={() => setReadOnly(true)}
                title="Read-only"
                description="View resources and run read-only queries."
              />
              <AccessModeOption
                checked={!readOnly}
                onSelect={() => setReadOnly(false)}
                disabled={locks.forceReadOnly}
                title="Full access"
                description="All read-only powers plus create, update, and delete."
                badge={
                  locks.forceReadOnly
                    ? { label: 'Locked by client', tone: 'warn' }
                    : undefined
                }
              />
            </div>
          </Section>

          <Section
            label="02"
            title="Project scope"
            description="Pin the agent to a single Neon project. Project-management tools (list, create, delete project) are hidden when set."
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={projectIdInputId}
                  className="text-xs font-medium uppercase tracking-[0.14em] text-neon-text-muted"
                >
                  Project ID{' '}
                  <span className="text-neon-text-muted/60 normal-case tracking-normal">
                    (optional)
                  </span>
                </label>
                {locks.projectIdLocked && (
                  <Badge tone="warn">Locked by client</Badge>
                )}
              </div>
              <input
                id={projectIdInputId}
                name="projectId"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="prj_…"
                value={projectId}
                disabled={locks.projectIdLocked}
                onChange={(e) => setProjectId(e.target.value)}
                aria-label="Project ID"
                className="w-full rounded-lg border border-neon-border bg-black/40 px-3.5 py-2.5 font-mono text-sm text-neon-text placeholder:text-neutral-600 focus:border-neon-green/60 focus:outline-none focus:ring-2 focus:ring-neon-green/30 disabled:cursor-not-allowed disabled:opacity-60"
                aria-describedby={`${projectIdInputId}-help`}
              />
              <p
                id={`${projectIdInputId}-help`}
                className="text-xs text-neon-text-muted"
              >
                Leave blank to allow access to every project you have permission
                for.
              </p>
            </div>
          </Section>

          <Section
            label="03"
            title="Tool categories"
            description={
              locks.categoriesLockedToSubsetOf !== null
                ? 'The MCP client requested a limited set of categories. You can deselect within this set, but cannot add new ones.'
                : 'Pick which categories of tools the agent can use. Unchecked categories are hidden from the model entirely.'
            }
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="rounded-md border border-neon-border bg-white/5 px-3 py-1.5 text-xs font-medium text-neon-text transition hover:border-neon-green/50 hover:bg-neon-green-soft hover:text-neon-green"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded-md border border-neon-border bg-white/5 px-3 py-1.5 text-xs font-medium text-neon-text transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200"
                >
                  Clear all
                </button>
              </div>
              <span className="text-xs text-neon-text-muted">
                {selectedAll
                  ? 'All categories enabled'
                  : `${categories.size} of ${allowedCategories.length} selected`}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {allowedCategories.map((cat) => {
                const display = SCOPE_CATEGORY_DISPLAY[cat];
                const checked = categories.has(cat);
                return (
                  <CategoryCheckbox
                    key={cat}
                    label={display.label}
                    description={display.description}
                    checked={checked}
                    onChange={() => toggleCategory(cat)}
                  />
                );
              })}
              {allowedCategories.length === 0 && (
                <p className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-200">
                  The client requested zero valid categories. Approving will
                  grant access only to discovery tools (search, fetch).
                </p>
              )}
            </div>
          </Section>

          <Section
            label="04"
            title="Tools preview"
            description="Live preview of the tools your client will see based on the choices above."
          >
            <ToolsPreview
              loading={preview.loading}
              error={preview.error}
              tools={previewTools}
              count={previewCount}
              notices={preview.data?.notices}
              warnings={preview.data?.warnings}
            />
          </Section>

          <div className="mt-10 flex flex-col-reverse gap-3 border-t border-neon-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-neon-text-muted">
              Approving redirects you to{' '}
              <span className="font-medium text-neon-text">neon.tech</span> to
              sign in. The MCP client never sees your Neon credentials.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <button
                type="submit"
                formAction={cancelConsent}
                onClick={() => setSubmitting('cancel')}
                disabled={submitting !== null}
                className="rounded-md border border-neon-border bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-neon-text transition hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"
              >
                {submitting === 'cancel' ? 'Cancelling…' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submitting !== null}
                className="rounded-md bg-neon-green px-5 py-2.5 text-sm font-semibold text-neutral-950 shadow-[0_0_20px_-6px_rgba(0,229,153,0.6)] transition hover:bg-[#1aebab] disabled:cursor-wait disabled:opacity-60"
              >
                {submitting === 'approve' ? 'Approving…' : 'Approve & continue'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function BrandHeader() {
  return (
    <div className="mb-10 flex items-center justify-center gap-3">
      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3"
        aria-label="Neon"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the brand
            logo is a tiny remote SVG; routing it through next/image would
            require configuring remotePatterns just for one icon. */}
        <img
          src="https://neon.com/brand/neon-logomark-dark-color.svg"
          alt=""
          className="h-9 w-9"
        />
        <span className="text-lg font-semibold tracking-tight">
          Neon <span className="text-neon-text-muted">/</span>{' '}
          <span className="text-neon-text-muted">MCP server</span>
        </span>
      </a>
    </div>
  );
}

function ClientInfoCard({ client }: { client: ConsentFormProps['client'] }) {
  return (
    <div className="mb-8 rounded-xl border border-neon-border bg-black/30 p-5 text-sm">
      <Detail
        label="Client"
        value={<span className="font-medium">{client.name}</span>}
      />
      {client.website && (
        <Detail
          label="Website"
          value={
            <a
              href={client.website}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-neon-green"
            >
              {client.website}
            </a>
          }
        />
      )}
      {client.redirectUris.length > 0 && (
        <Detail
          label={
            <span className="flex items-center gap-1.5">
              Redirect URI
              {client.redirectUris.length > 1 ? 's' : ''}
              <span
                title="OAuth tokens will be returned to this exact URI. The Neon MCP server validates against the registered list."
                className="cursor-help text-neon-text-muted"
              >
                ⓘ
              </span>
            </span>
          }
          value={
            <div className="flex flex-col gap-1 font-mono text-xs">
              {client.redirectUris.map((uri) => (
                <span key={uri} className="break-all">
                  {uri}
                </span>
              ))}
            </div>
          }
        />
      )}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <div className="min-w-32 text-neon-text-muted">{label}</div>
      <div className="flex-1 break-all text-neon-text">{value}</div>
    </div>
  );
}

function Section({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-xs font-medium text-neon-green">
          {label}
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-neon-text">
            {title}
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-neon-text-muted">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function AccessModeOption({
  checked,
  onSelect,
  disabled,
  title,
  description,
  badge,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  description: string;
  badge?: { label: string; tone: 'warn' };
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role="radio"
      aria-checked={checked}
      // The button's *accessible* name is the title alone — we don't want
      // the description leaking into screen-reader announcements or test
      // queries because the description is purely advisory text.
      aria-label={title}
      disabled={disabled}
      className={[
        'group flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition',
        checked
          ? 'border-neon-green/60 bg-neon-green-soft shadow-[inset_0_0_0_1px_rgba(0,229,153,0.4)]'
          : 'border-neon-border bg-white/[0.02] hover:border-neon-green/30 hover:bg-white/[0.04]',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      ].join(' ')}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium text-neon-text" aria-hidden>
          {title}
        </span>
        <div className="flex items-center gap-2">
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          <span
            aria-hidden
            className={[
              'flex size-4 items-center justify-center rounded-full border transition',
              checked
                ? 'border-neon-green bg-neon-green'
                : 'border-white/20 group-hover:border-white/40',
            ].join(' ')}
          >
            {checked && (
              <span className="size-1.5 rounded-full bg-neutral-950" />
            )}
          </span>
        </div>
      </div>
      <span
        className="text-xs leading-relaxed text-neon-text-muted"
        aria-hidden
      >
        {description}
      </span>
    </button>
  );
}

function CategoryCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={[
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
        checked
          ? 'border-neon-green/40 bg-neon-green-soft/60'
          : 'border-neon-border bg-white/[0.02] hover:border-neon-green/20 hover:bg-white/[0.04]',
      ].join(' ')}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="mt-0.5 size-4 cursor-pointer accent-[#00E599]"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-neon-text">{label}</div>
        <div className="text-xs text-neon-text-muted">{description}</div>
      </div>
    </label>
  );
}

function Badge({
  children,
  tone,
  className = '',
}: {
  children: React.ReactNode;
  tone: 'warn' | 'info';
  className?: string;
}) {
  const tones = {
    warn: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200',
    info: 'border-neon-green/40 bg-neon-green-soft text-neon-green',
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

function ToolsPreview({
  loading,
  error,
  tools,
  count,
  notices,
  warnings,
}: {
  loading: boolean;
  error: string | null;
  tools: ToolPreviewItem[];
  count: number;
  notices?: string[];
  warnings?: string[];
}) {
  // Group tools by category so the preview reads as "Querying: Run SQL,
  // Explain SQL Statement, …" rather than as a flat 30-chip blob. Also
  // sort categories in the canonical order so the layout stays stable
  // across renders. Hook must run before any early return per the
  // rules of hooks.
  const grouped = useMemoGroupedTools(tools);

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-200">
        Could not load tools preview: {error}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neon-border bg-black/20 p-4">
      <div className="mb-3 flex items-center justify-between text-xs">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-neon-text-muted">
            <span className="size-2 animate-pulse rounded-full bg-neon-green" />
            Updating preview…
          </span>
        ) : (
          <span className="text-neon-text-muted">
            <span className="font-semibold text-neon-text">{count}</span>{' '}
            {count === 1 ? 'tool' : 'tools'} available
          </span>
        )}
      </div>

      {warnings && warnings.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-xs">
          {warnings.map((w) => (
            <li
              key={w}
              className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 leading-relaxed text-yellow-200"
            >
              {w}
            </li>
          ))}
        </ul>
      )}
      {notices && notices.length > 0 && (
        <ul className="mb-3 space-y-1.5 text-xs">
          {notices.map((n) => (
            <li
              key={n}
              className="rounded-md border border-neon-border bg-white/[0.03] px-3 py-2 leading-relaxed text-neon-text-muted"
            >
              {n}
            </li>
          ))}
        </ul>
      )}

      {loading && tools.length === 0 ? (
        <ToolsPreviewSkeleton />
      ) : tools.length > 0 ? (
        <ul className="space-y-3">
          {grouped.map(({ scope, items }) => (
            <li key={scope}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-neon-text-muted">
                {scope === 'global' ? 'Always available' : labelForScope(scope)}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {items.map((tool) => (
                  <li
                    key={tool.name}
                    className={[
                      'rounded-md border px-2 py-1 text-xs',
                      tool.readOnlySafe
                        ? 'border-neon-green/30 bg-neon-green-soft text-neon-green'
                        : 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200',
                    ].join(' ')}
                    title={`${tool.title}${tool.readOnlySafe ? ' · read-only safe' : ' · can mutate'}`}
                  >
                    {tool.title}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-neon-border bg-white/[0.02] px-3 py-3 text-xs text-neon-text-muted">
          No tools would be available with these settings. The agent will not be
          able to interact with Neon resources.
        </p>
      )}
    </div>
  );
}

function ToolsPreviewSkeleton() {
  return (
    <div className="space-y-3">
      {[16, 24, 12].map((widths, gIdx) => (
        <div key={gIdx}>
          <div className="mb-1.5 h-2 w-24 animate-pulse rounded bg-white/[0.06]" />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 4 + gIdx }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded-md bg-white/[0.06]"
                style={{ width: `${widths + i * 6}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = {
  projects: 'Projects',
  branches: 'Branches',
  schema: 'Schema',
  querying: 'Querying',
  neon_auth: 'Neon Auth',
  data_api: 'Data API',
  docs: 'Docs',
};

function labelForScope(scope: string): string {
  return SCOPE_LABEL[scope] ?? scope;
}

const CATEGORY_ORDER: ReadonlyArray<ScopeCategory | 'global'> = [
  'projects',
  'branches',
  'schema',
  'querying',
  'neon_auth',
  'data_api',
  'docs',
  'global',
];

function useMemoGroupedTools(
  tools: ToolPreviewItem[],
): Array<{ scope: ScopeCategory | 'global'; items: ToolPreviewItem[] }> {
  return useMemo(() => {
    const buckets = new Map<ScopeCategory | 'global', ToolPreviewItem[]>();
    for (const tool of tools) {
      const arr = buckets.get(tool.scope) ?? [];
      arr.push(tool);
      buckets.set(tool.scope, arr);
    }
    return CATEGORY_ORDER.flatMap((scope) => {
      const items = buckets.get(scope);
      if (!items || items.length === 0) return [];
      return [
        {
          scope,
          items: items.sort((a, b) => a.title.localeCompare(b.title)),
        },
      ];
    });
  }, [tools]);
}
