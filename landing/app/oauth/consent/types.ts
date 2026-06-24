import type { ScopeCategory } from '../../../mcp-src/utils/grant-context';

/**
 * Shape stored inside the HMAC-signed envelope that travels through the
 * user's browser between `GET /api/authorize` and the consent Server
 * Action. The `authRequest` block is a verbatim copy of the parsed
 * downstream OAuth request — we re-sign it server-side instead of
 * trusting form input verbatim, fixing the tamper window the previous
 * `btoa(JSON.stringify(...))` form field had (see commit message).
 */
export type ConsentSignedPayload = {
  authRequest: {
    responseType: string;
    clientId: string;
    redirectUri: string;
    scope: string[];
    state: string;
    resource?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  };
  /** Scope set the client requested (filtered to known scopes). */
  requestedScope: string[];
  /**
   * Whether the client's resource URI / register-time headers / direct
   * `?readonly=` param indicate the consent dialog should default to
   * read-only mode. When `true` *and* the scope set is exactly `["read"]`
   * the form treats this as a hard lock (user can't widen to write).
   */
  defaultReadOnly: boolean;
  /** Issued-at timestamp (ms) — used for short-window replay defense. */
  iat: number;
};

export type ConsentClientInfo = {
  name: string;
  website: string | null;
  redirectUris: string[];
};

export type ConsentFormProps = {
  signedState: string;
  client: ConsentClientInfo;
  initial: {
    readOnly: boolean;
    /** Categories the client requested, or null when unconstrained. */
    categories: ScopeCategory[] | null;
    projectId: string | null;
  };
  locks: {
    /**
     * Set when the MCP client capped categories via its resource URI.
     * The form renders only this subset (narrowing-only policy) and
     * disables the "everything" radio.
     */
    categoriesLockedToSubsetOf: ScopeCategory[] | null;
    /** Set when the MCP client pinned a single project. */
    projectIdLocked: boolean;
    /** Set when read-only is non-negotiable (only `read` was requested). */
    forceReadOnly: boolean;
  };
};
