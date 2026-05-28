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
    <div className="min-h-screen bg-[#0a0c09] text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 flex items-center justify-center">
          <a href="/" target="_blank" rel="noreferrer" aria-label="Neon">
            {/* eslint-disable-next-line @next/next/no-img-element -- the brand
                logo is a tiny remote SVG; routing it through next/image would
                require configuring remotePatterns just for one icon. */}
            <img
              src="https://neon.com/brand/neon-logomark-dark-color.svg"
              alt="Neon MCP"
              className="h-12 w-12 rounded-lg"
            />
          </a>
        </div>

        <form
          id={formId}
          action={approveConsent}
          onSubmit={() => setSubmitting('approve')}
          className="rounded-xl border border-white/10 bg-black/40 p-6 shadow-[0_0_28px_-12px_rgb(0_230_153_/_0.55)] sm:p-8"
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

          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              Authorize {client.name}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {client.name} is requesting access to your Neon resources via the
              Neon MCP server. Review and adjust the access below, then approve
              to continue.
            </p>
          </header>

          <ClientInfoCard client={client} />

          <Section
            title="Access mode"
            description="Pick how much the agent is allowed to do on your behalf."
          >
            <div
              role="radiogroup"
              aria-label="Access mode"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <AccessModeOption
                checked={readOnly}
                onSelect={() => setReadOnly(true)}
                title="Read-only"
                description="View resources and run read-only SQL. Safer default."
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
            title="Project scope"
            description="Optionally pin the agent to a single Neon project. Project-management tools (list/create/delete project) are hidden when set."
          >
            <label
              htmlFor={projectIdInputId}
              className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-400"
            >
              Project ID
              {locks.projectIdLocked && (
                <Badge tone="warn" className="ml-2">
                  Locked by client
                </Badge>
              )}
            </label>
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
              className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/60 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-60"
              aria-describedby={`${projectIdInputId}-help`}
            />
            <p
              id={`${projectIdInputId}-help`}
              className="mt-2 text-xs text-neutral-500"
            >
              Leave blank to allow access to every project you have permission
              for.
            </p>
          </Section>

          <Section
            title="Tool categories"
            description={
              locks.categoriesLockedToSubsetOf !== null
                ? 'The MCP client requested a limited set of categories. You can deselect within this set, but cannot add new ones.'
                : 'Pick which categories of tools the agent can use. Unchecked categories are hidden from the model entirely.'
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleSelectAll}
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-300 transition hover:border-red-400/40 hover:bg-red-400/10"
              >
                Clear all
              </button>
              {selectedAll && (
                <span className="text-neutral-500">
                  All categories selected
                </span>
              )}
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
            title="Tools preview"
            description={`Live preview of the tools your client will see based on the choices above.`}
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

          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="submit"
              formAction={cancelConsent}
              onClick={() => setSubmitting('cancel')}
              disabled={submitting !== null}
              className="rounded-md border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-neutral-300 transition hover:bg-white/5 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting !== null}
              className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting === 'approve' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Approving redirects you to Neon to sign in. The MCP client never sees
          your Neon credentials. Read more about the{' '}
          <a
            href="https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization"
            className="underline decoration-dotted"
            target="_blank"
            rel="noreferrer"
          >
            MCP authorization spec
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function ClientInfoCard({ client }: { client: ConsentFormProps['client'] }) {
  return (
    <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
      <Detail label="Name" value={client.name} />
      {client.website && (
        <Detail
          label="Website"
          value={
            <a
              href={client.website}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted"
            >
              {client.website}
            </a>
          }
        />
      )}
      {client.redirectUris.length > 0 && (
        <Detail
          label="Redirect URIs"
          value={
            <div className="flex flex-col gap-0.5 font-mono text-xs">
              {client.redirectUris.map((uri) => (
                <span key={uri}>{uri}</span>
              ))}
            </div>
          }
        />
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
      <div className="min-w-32 text-neutral-400">{label}</div>
      <div className="flex-1 break-all text-neutral-200">{value}</div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 border-t border-white/5 pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-300">
        {title}
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-neutral-500">
        {description}
      </p>
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
        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
        checked
          ? 'border-emerald-400/60 bg-emerald-400/10'
          : 'border-white/10 bg-white/[0.02] hover:border-emerald-400/30 hover:bg-emerald-400/5',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      ].join(' ')}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-medium text-neutral-100" aria-hidden>
          {title}
        </span>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <span className="text-xs leading-relaxed text-neutral-400" aria-hidden>
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
          ? 'border-emerald-400/40 bg-emerald-400/[0.06]'
          : 'border-white/10 bg-white/[0.02] hover:border-emerald-400/20 hover:bg-emerald-400/[0.03]',
      ].join(' ')}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 cursor-pointer accent-emerald-400"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-neutral-100">{label}</div>
        <div className="text-xs text-neutral-400">{description}</div>
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
  tone: 'warn';
  className?: string;
}) {
  const tones = {
    warn: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200',
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
  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-200">
        Could not load tools preview: {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-neutral-400">
        {loading ? (
          <span className="inline-flex items-center gap-1">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400/60" />
            Updating preview…
          </span>
        ) : (
          <span>
            <span className="font-semibold text-neutral-200">{count}</span>{' '}
            tools available
          </span>
        )}
      </div>

      {warnings && warnings.length > 0 && (
        <ul className="mb-2 space-y-1 text-xs text-yellow-200">
          {warnings.map((w) => (
            <li
              key={w}
              className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-2 py-1.5"
            >
              {w}
            </li>
          ))}
        </ul>
      )}
      {notices && notices.length > 0 && (
        <ul className="mb-2 space-y-1 text-xs text-neutral-400">
          {notices.map((n) => (
            <li
              key={n}
              className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5"
            >
              {n}
            </li>
          ))}
        </ul>
      )}

      {tools.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.04] px-2 py-1 text-xs text-emerald-200/90"
              title={`${tool.title}${tool.readOnlySafe ? ' · read-only safe' : ''}`}
            >
              {tool.title}
            </li>
          ))}
        </ul>
      ) : (
        !loading && (
          <p className="text-xs text-neutral-500">
            No tools would be available with these settings.
          </p>
        )
      )}
    </div>
  );
}
