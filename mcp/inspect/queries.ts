/**
 * Diagnostic SQL behind the `inspect_database` tool. Each entry is a read-only
 * query against Postgres' own statistics and catalog views, plus the output
 * columns in display order.
 *
 * Every query is copied verbatim from the `neon` CLI, where the same catalog
 * powers `neon inspect db <check>`:
 * neondatabase/neon-pkgs, packages/cli/src/utils/inspect_queries.ts @ 6ff43d7.
 * The CLI does not publish this module, so the SQL is duplicated rather than
 * imported. Keep the SQL a verbatim copy — port fixes in both directions instead
 * of letting the two catalogs diverge.
 *
 * The `describe` strings deliberately differ from the CLI's for `unused-indexes`,
 * `outliers`, `calls`, and `bloat`. Here they are the enum documentation a model
 * routes on, so they name the thresholds the SQL applies (`< 50` scans, `LIMIT
 * 25`) rather than calling the result "few scans" or "the most expensive
 * queries". `sqlLimit` carries the same fact in machine-readable form.
 *
 * Most checks need no extra extension. The ones that do declare it via
 * `requiresExtension`; the handler verifies the extension is installed first and
 * fails with an actionable "enable it with CREATE EXTENSION …" message when it
 * is not.
 */

import type { InspectQueryScope } from './targets';

/**
 * Every available check, in the order they are offered to the model. Declared as
 * a tuple so it can back a Zod enum directly, which keeps the tool's input
 * schema and this catalog from drifting apart.
 */
export const INSPECT_CHECKS = [
  'table-sizes',
  'index-sizes',
  'unused-indexes',
  'seq-scans',
  'long-running-queries',
  'stalled-queries',
  'locks',
  'outliers',
  'calls',
  'lfc-hit-rate',
  'working-set',
  'vacuum-stats',
  'bloat',
  'replication-slots',
  'subscriptions',
] as const;

export type InspectCheck = (typeof INSPECT_CHECKS)[number];

export type InspectQuery = {
  /** One-line description of what the check reports. */
  describe: string;
  /** The read-only SQL to execute. */
  sql: string;
  /** Output columns, in display order. */
  fields: readonly string[];
  /** Explanation to return instead of an empty row set. */
  emptyMessage: string;
  emptyMessageAll?: string;
  /**
   * Row ceiling the SQL itself imposes, for the checks that carry a `LIMIT`.
   * Without it a capped result is indistinguishable from a complete one, and the
   * response would report `truncated: false` on a row set Postgres already cut.
   */
  sqlLimit?: number;
  /**
   * Postgres extension the query needs (e.g. `pg_stat_statements`). When set,
   * the handler verifies the extension is installed before running the query.
   */
  requiresExtension?: string;
  /**
   * Database catalogs differ, while compute-wide views return the same rows
   * from every database.
   */
  scope: InspectQueryScope;
};

/**
 * Typed as an exact `Record` so adding a check to `INSPECT_CHECKS` without
 * writing its query is a compile error.
 */
export const INSPECT_QUERIES: Record<InspectCheck, InspectQuery> = {
  'table-sizes': {
    describe:
      'Size of each table (including TOAST), largest first (pg_table_size)',
    scope: 'database',
    fields: ['schema', 'name', 'size'],
    emptyMessage: 'No user tables found.',
    sql: /* sql */ `
      SELECT
        n.nspname AS schema,
        c.relname AS name,
        pg_size_pretty(pg_table_size(c.oid)) AS size
      FROM pg_class c
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast'
        AND c.relkind = 'r'
      ORDER BY pg_table_size(c.oid) DESC;
    `,
  },
  'index-sizes': {
    describe: 'Size of each index, largest first (pg_relation_size)',
    scope: 'database',
    fields: ['schema', 'name', 'size'],
    emptyMessage: 'No indexes found.',
    sql: /* sql */ `
      SELECT
        n.nspname AS schema,
        c.relname AS name,
        pg_size_pretty(pg_relation_size(c.oid)) AS size
      FROM pg_class c
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast'
        AND c.relkind = 'i'
      ORDER BY pg_relation_size(c.oid) DESC;
    `,
  },
  'unused-indexes': {
    describe:
      'Non-unique indexes with fewer than 50 scans — candidates for removal (pg_stat_user_indexes)',
    scope: 'database',
    fields: ['table', 'index', 'index_size', 'index_scans'],
    emptyMessage: 'No unused indexes detected.',
    sql: /* sql */ `
      SELECT
        s.schemaname || '.' || s.relname AS "table",
        s.indexrelname AS index,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
        s.idx_scan AS index_scans
      FROM pg_stat_user_indexes s
      JOIN pg_index i ON i.indexrelid = s.indexrelid
      WHERE NOT i.indisunique
        AND NOT i.indisprimary
        AND s.idx_scan < 50
      ORDER BY pg_relation_size(s.indexrelid) DESC, s.idx_scan ASC;
    `,
  },
  'seq-scans': {
    describe:
      'Number of sequential scans recorded against each table (pg_stat_user_tables)',
    scope: 'database',
    fields: ['schema', 'name', 'count'],
    emptyMessage: 'No user tables found.',
    sql: /* sql */ `
      SELECT
        schemaname AS schema,
        relname AS name,
        seq_scan AS count
      FROM pg_stat_user_tables
      ORDER BY seq_scan DESC;
    `,
  },
  'long-running-queries': {
    describe: 'Queries running longer than 5 minutes (pg_stat_activity)',
    scope: 'database',
    fields: ['pid', 'duration', 'state', 'query'],
    emptyMessage: 'No long-running queries in this database.',
    emptyMessageAll: 'No long-running queries in any database.',
    // `pg_stat_activity` spans every database on the compute, so without the
    // `datname` filter this reports queries the caller did not ask about and
    // cannot act on.
    sql: /* sql */ `
      SELECT
        pid,
        (now() - query_start)::text AS duration,
        state,
        query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state <> 'idle'
        AND query NOT ILIKE '%pg_stat_activity%'
        AND now() - query_start > interval '5 minutes'
      ORDER BY now() - query_start DESC;
    `,
  },
  'stalled-queries': {
    describe:
      'Active queries running longer than 30 seconds with parallel-worker grouping, waits, and blockers (compute-wide)',
    scope: 'compute',
    fields: [
      'observed_at',
      'query_start',
      'query_group',
      'pid',
      'leader_pid',
      'role',
      'backend_type',
      'database',
      'application_name',
      'query_id',
      'state',
      'wait_event_type',
      'wait_event',
      'blocking_pids',
      'duration',
      'query',
    ],
    emptyMessage:
      'No active queries running longer than 30 seconds on this compute.',
    sql: /* sql */ `
      WITH activity AS MATERIALIZED (
        SELECT *
        FROM pg_stat_activity
        WHERE state = 'active'
          AND backend_type IN ('client backend', 'parallel worker')
          AND pid <> pg_backend_pid()
      ),
      stalled_groups AS (
        SELECT DISTINCT COALESCE(leader_pid, pid) AS query_group
        FROM activity
        WHERE query_start <= statement_timestamp() - interval '30 seconds'
      )
      SELECT
        statement_timestamp() AS observed_at,
        a.query_start,
        g.query_group,
        a.pid,
        a.leader_pid,
        CASE
          WHEN a.leader_pid IS NULL THEN 'leader'
          ELSE 'worker'
        END AS role,
        a.backend_type,
        a.datname AS database,
        a.application_name,
        a.query_id::text AS query_id,
        a.state,
        a.wait_event_type,
        a.wait_event,
        array_to_string(pg_blocking_pids(a.pid), ',') AS blocking_pids,
        (statement_timestamp() - a.query_start)::text AS duration,
        a.query
      FROM activity a
      JOIN stalled_groups g
        ON g.query_group = COALESCE(a.leader_pid, a.pid)
      ORDER BY g.query_group, a.leader_pid NULLS FIRST, a.pid;
    `,
  },
  locks: {
    describe:
      'Locks held with the acquiring query and its age (pg_locks + pg_stat_activity)',
    scope: 'database',
    fields: ['pid', 'relname', 'mode', 'locktype', 'granted', 'age', 'query'],
    emptyMessage: 'No locks held in this database.',
    emptyMessageAll: 'No locks held in any database.',
    // Restricting to backends connected to this database does two things.
    // `pg_locks` covers the whole compute, so it otherwise reports locks the
    // caller did not ask about; and `l.relation` is an OID that only means
    // anything in `l.database`, so joining a foreign database's OID against the
    // local `pg_class` returned a null name, or a different relation that
    // happened to share the OID. Filtering on the holding session means no
    // foreign-database OID reaches that join. Filtering on `l.database`
    // instead would drop `transactionid` and `virtualxid` locks, which carry
    // no database.
    sql: /* sql */ `
      SELECT
        a.pid,
        c.relname,
        l.mode,
        l.locktype,
        l.granted,
        (now() - a.query_start)::text AS age,
        a.query
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      WHERE a.datname = current_database()
        AND a.query <> '<insufficient privilege>'
        AND l.pid <> pg_backend_pid()
      ORDER BY a.query_start;
    `,
  },
  outliers: {
    describe:
      'The 25 queries with the highest cumulative execution time since statistics were last reset (needs pg_stat_statements)',
    scope: 'database',
    fields: ['total_exec_time', 'prop_exec_time', 'ncalls', 'query'],
    emptyMessage: 'No statements recorded yet.',
    sqlLimit: 25,
    requiresExtension: 'pg_stat_statements',
    sql: /* sql */ `
      SELECT
        (interval '1 millisecond' * total_exec_time)::text AS total_exec_time,
        to_char(
          (total_exec_time / nullif(sum(total_exec_time) OVER (), 0)) * 100,
          'FM990D0'
        ) || '%' AS prop_exec_time,
        calls AS ncalls,
        query
      FROM pg_stat_statements s
      JOIN pg_database d ON d.oid = s.dbid
      WHERE d.datname = current_database()
      ORDER BY total_exec_time DESC
      LIMIT 25;
    `,
  },
  calls: {
    describe:
      'The 25 most frequently executed queries since statistics were last reset (needs pg_stat_statements)',
    scope: 'database',
    fields: ['ncalls', 'total_exec_time', 'prop_exec_time', 'query'],
    emptyMessage: 'No statements recorded yet.',
    sqlLimit: 25,
    requiresExtension: 'pg_stat_statements',
    sql: /* sql */ `
      SELECT
        calls AS ncalls,
        (interval '1 millisecond' * total_exec_time)::text AS total_exec_time,
        to_char(
          (calls / nullif(sum(calls) OVER (), 0)::float) * 100,
          'FM990D0'
        ) || '%' AS prop_exec_time,
        query
      FROM pg_stat_statements s
      JOIN pg_database d ON d.oid = s.dbid
      WHERE d.datname = current_database()
      ORDER BY calls DESC
      LIMIT 25;
    `,
  },
  'lfc-hit-rate': {
    describe: 'Local File Cache hit rate (compute-wide, needs neon extension)',
    scope: 'compute',
    fields: ['name', 'ratio'],
    emptyMessage: 'No LFC stats available.',
    requiresExtension: 'neon',
    // Read the hit/miss counters from neon_get_lfc_stats() rather than the
    // neon_lfc_stats / neon_stat_file_cache views: those views are owned by
    // cloud_admin and are not always readable by end-user roles, whereas the
    // function is EXECUTE-able by the default role.
    sql: /* sql */ `
      WITH lfc AS (
        SELECT lfc_key AS k, lfc_value AS v
        FROM neon_get_lfc_stats() t(lfc_key text, lfc_value bigint)
      )
      SELECT
        'lfc hit rate' AS name,
        max(v) FILTER (WHERE k = 'file_cache_hits')::float
          / nullif(
            max(v) FILTER (WHERE k = 'file_cache_hits')
            + max(v) FILTER (WHERE k = 'file_cache_misses'),
            0
          ) AS ratio
      FROM lfc;
    `,
  },
  'working-set': {
    describe:
      'Estimated working set vs LFC size (compute-wide, needs neon extension)',
    scope: 'compute',
    fields: ['window', 'working_set', 'lfc_size', 'exceeds_lfc'],
    emptyMessage: 'No working-set estimate available.',
    requiresExtension: 'neon',
    sql: /* sql */ `
      SELECT
        w.window,
        pg_size_pretty(w.working_set_bytes) AS working_set,
        pg_size_pretty(pg_size_bytes(current_setting('neon.file_cache_size_limit'))) AS lfc_size,
        CASE
          WHEN w.working_set_bytes
            > pg_size_bytes(current_setting('neon.file_cache_size_limit'))
          THEN 'yes' ELSE 'no'
        END AS exceeds_lfc
      FROM (
        SELECT
          x AS window,
          approximate_working_set_size_seconds(
            extract('epoch' from x::interval)::int
          )::bigint * 8192 AS working_set_bytes
        FROM (VALUES ('1m'), ('5m'), ('15m'), ('1h')) AS t(x)
      ) w
      ORDER BY working_set_bytes;
    `,
  },
  'vacuum-stats': {
    describe:
      'Autovacuum status per table: last (auto)vacuum, dead tuples, threshold',
    scope: 'database',
    fields: [
      'schema',
      'table',
      'last_vacuum',
      'last_autovacuum',
      'rowcount',
      'dead_rowcount',
      'expect_autovacuum',
    ],
    emptyMessage: 'No user tables found.',
    sql: /* sql */ `
      SELECT
        n.nspname AS schema,
        c.relname AS "table",
        to_char(psut.last_vacuum, 'YYYY-MM-DD HH24:MI') AS last_vacuum,
        to_char(psut.last_autovacuum, 'YYYY-MM-DD HH24:MI') AS last_autovacuum,
        c.reltuples::bigint AS rowcount,
        psut.n_dead_tup AS dead_rowcount,
        CASE
          WHEN current_setting('autovacuum_vacuum_threshold')::bigint
            + current_setting('autovacuum_vacuum_scale_factor')::numeric
              * c.reltuples
            < psut.n_dead_tup
          THEN 'yes'
          ELSE 'no'
        END AS expect_autovacuum
      FROM pg_stat_user_tables psut
      JOIN pg_class c ON psut.relid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      ORDER BY psut.n_dead_tup DESC;
    `,
  },
  bloat: {
    describe:
      'Estimated bloat for the 25 most bloated tables (statistical estimate, no extension needed)',
    scope: 'database',
    fields: ['type', 'schema', 'object_name', 'bloat', 'waste'],
    emptyMessage: 'No bloat estimate available.',
    sqlLimit: 25,
    sql: /* sql */ `
      WITH constants AS (
        SELECT current_setting('block_size')::numeric AS bs, 23 AS hdr, 8 AS ma
      ),
      bloat_info AS (
        SELECT
          ma, bs, schemaname, tablename,
          (datawidth + (hdr + ma - (CASE WHEN hdr % ma = 0 THEN ma ELSE hdr % ma END)))::numeric AS datahdr,
          (maxfracsum * (nullhdr + ma - (CASE WHEN nullhdr % ma = 0 THEN ma ELSE nullhdr % ma END))) AS nullhdr2
        FROM (
          SELECT
            schemaname, tablename, hdr, ma, bs,
            SUM((1 - null_frac) * avg_width) AS datawidth,
            MAX(null_frac) AS maxfracsum,
            hdr + (
              SELECT 1 + count(*) / 8
              FROM pg_stats s2
              WHERE null_frac <> 0
                AND s2.schemaname = s.schemaname
                AND s2.tablename = s.tablename
            ) AS nullhdr
          FROM pg_stats s, constants
          GROUP BY 1, 2, 3, 4, 5
        ) AS foo
      ),
      table_bloat AS (
        SELECT
          schemaname, tablename, cc.relpages, bs,
          CEIL((cc.reltuples * ((datahdr + ma
            - (CASE WHEN datahdr % ma = 0 THEN ma ELSE datahdr % ma END))
            + nullhdr2 + 4)) / (bs - 20::float)) AS otta
        FROM bloat_info
        JOIN pg_class cc ON cc.relname = bloat_info.tablename
        JOIN pg_namespace nn ON cc.relnamespace = nn.oid
          AND nn.nspname = bloat_info.schemaname
          AND nn.nspname NOT IN ('information_schema', 'pg_catalog')
        WHERE cc.relkind = 'r'
      )
      SELECT
        'table' AS type,
        schemaname AS schema,
        tablename AS object_name,
        round(CASE WHEN otta = 0 THEN 0.0 ELSE relpages::numeric / otta::numeric END, 1) AS bloat,
        pg_size_pretty(
          (CASE WHEN relpages < otta THEN 0 ELSE (bs * (relpages - otta))::bigint END)
        ) AS waste
      FROM table_bloat
      ORDER BY (CASE WHEN relpages < otta THEN 0 ELSE bs * (relpages - otta) END) DESC
      LIMIT 25;
    `,
  },
  'replication-slots': {
    describe:
      'Replication slots (compute-wide): kind, status, client, restart/confirmed-flush LSNs, and lag (pg_replication_slots + pg_stat_replication)',
    scope: 'compute',
    fields: [
      'slot_name',
      'slot_type',
      'slot_kind',
      'status',
      'client_addr',
      'restart_lsn',
      'confirmed_flush_lsn',
      'replication_lag',
    ],
    emptyMessage: 'No replication slots found.',
    sql: /* sql */ `
      SELECT
        s.slot_name,
        s.slot_type,
        CASE
          WHEN s.slot_type = 'physical' THEN 'physical'
          WHEN s.slot_name LIKE 'pg_%_sync_%' THEN 'initial-sync (tablesync)'
          WHEN s.slot_type = 'logical' THEN 'CDC (apply)'
          ELSE 'other'
        END AS slot_kind,
        CASE
          WHEN r.state IS NOT NULL THEN r.state
          WHEN s.active THEN 'active (no walsender)'
          ELSE 'inactive'
        END AS status,
        r.client_addr,
        s.restart_lsn,
        s.confirmed_flush_lsn,
        pg_size_pretty(
          pg_wal_lsn_diff(
            CASE
              WHEN pg_is_in_recovery() THEN pg_last_wal_receive_lsn()
              ELSE pg_current_wal_lsn()
            END,
            COALESCE(s.confirmed_flush_lsn, s.restart_lsn)
          )
        ) AS replication_lag
      FROM pg_replication_slots s
      LEFT JOIN pg_stat_replication r ON r.pid = s.active_pid
      ORDER BY s.slot_name;
    `,
  },
  subscriptions: {
    describe:
      'Per-table logical replication progress on this subscriber (pg_subscription_rel)',
    scope: 'database',
    fields: ['subscription', 'table_name', 'status', 'lsn'],
    emptyMessage: 'No subscriptions found on this database.',
    emptyMessageAll: 'No subscriptions found on any database.',
    sql: /* sql */ `
      SELECT
        sub.subname AS subscription,
        sr.srrelid::regclass::text AS table_name,
        CASE sr.srsubstate
          WHEN 'i' THEN 'initialize'
          WHEN 'd' THEN 'data being copied'
          WHEN 'f' THEN 'finished table copy'
          WHEN 's' THEN 'synchronized'
          WHEN 'r' THEN 'ready'
          ELSE sr.srsubstate::text
        END AS status,
        sr.srsublsn AS lsn
      FROM pg_subscription_rel sr
      JOIN pg_subscription sub ON sub.oid = sr.srsubid
      ORDER BY sub.subname, table_name;
    `,
  },
};

/**
 * Rows returned per call unless the caller raises it. Diagnostics like
 * `table-sizes` are unbounded in SQL, and a few thousand rows would crowd out the
 * model's context, so the handler caps the response and reports the full count.
 */
export const INSPECT_DEFAULT_LIMIT = 50;

/** Ceiling on `limit`, so a diagnostic can never return an unbounded response. */
export const INSPECT_MAX_LIMIT = 1000;

/** `check`-parameter documentation, generated so it cannot drift from the catalog. */
export const INSPECT_CHECK_LIST = INSPECT_CHECKS.map(
  (check) => `\`${check}\`: ${INSPECT_QUERIES[check].describe}`,
).join('\n');
