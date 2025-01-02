import { Eval, EvalCase, Reporter, reportFailures } from 'braintrust';
import { LLMClassifierFromTemplate } from 'autoevals';

import { createApiClient } from '@neondatabase/api-client';
import { deleteNonDefaultBranches, evaluateTask } from './evalUtils';

const EVAL_INFO = {
  projectId: 'black-recipe-75251165',
  roleName: 'neondb_owner',
  databaseName: 'neondb',
  mainBranchId: 'br-cold-bird-a5icgh5h',
};

const getMainBranchDatabaseSchema = async () => {
  const neonClient = createApiClient({
    apiKey: process.env.NEON_API_KEY!,
  });

  const dbSchema = await neonClient.getProjectBranchSchema({
    projectId: EVAL_INFO.projectId,
    branchId: EVAL_INFO.mainBranchId,
    db_name: EVAL_INFO.databaseName,
  });

  return dbSchema.data.sql;
};

const factualityAnthropic = LLMClassifierFromTemplate({
  name: 'Factuality Anthropic',
  promptTemplate: `
  You are comparing a submitted answer to an expert answer on a given question. Here is the data:
[BEGIN DATA]
************
[Question]: {{{input}}}
************
[Expert]: {{{expected}}}
************
[Submission]: {{{output}}}
************
[END DATA]

Compare the factual content of the submitted answer with the expert answer. 
Implementation details like specific IDs, or exact formatting should be considered non-factual differences.

Ignore the following differences:
- Specific migration IDs or references
- Formatting or structural variations
- Order of presenting the information
- Restatements of the same request/question
- Additional confirmatory language that doesn't add new information

The submitted answer may either be:
(A) A subset missing key factual information from the expert answer
(B) A superset that FIRST agrees with the expert answer's core facts AND THEN adds additional factual information  
(C) Factually equivalent to the expert answer
(D) In factual disagreement with or takes a completely different action than the expert answer
(E) Different only in non-factual implementation details

Select the most appropriate option, prioritizing the core factual content over implementation specifics.
  `,
  choiceScores: {
    A: 0.4,
    B: 0.8,
    C: 1,
    D: 0,
    E: 1,
  },
  temperature: 0,
  useCoT: true,
  model: 'claude-3-5-sonnet-20241022',
});

const mainBranchIntegrityCheck = async (args: {
  input: string;
  output: string;
  expected: string;
  metadata?: {
    databaseSchemaBeforeRun: string;
    databaseSchemaAfterRun: string;
  };
}) => {
  const databaseSchemaBeforeRun = args.metadata?.databaseSchemaBeforeRun;
  const databaseSchemaAfterRun = args.metadata?.databaseSchemaAfterRun;
  const databaseSchemaAfterRunResponseIsComplete =
    databaseSchemaAfterRun?.includes('PostgreSQL database dump complete') ??
    false;

  // sometimes the pg_dump fails to deliver the full responses, which leads to false negatives
  // so we must eject
  if (!databaseSchemaAfterRunResponseIsComplete) {
    return null;
  }

  const isSame = databaseSchemaBeforeRun === databaseSchemaAfterRun;

  return {
    name: 'Main Branch Integrity Check',
    score: isSame ? 1 : 0,
  };
};

Eval('prepare_database_migration', {
  data: (): EvalCase<
    string,
    string,
    | {
        databaseSchemaBeforeRun: string;
        databaseSchemaAfterRun: string;
      }
    | undefined
  >[] => {
    return [
      // Add column
      {
        input: `in my ${EVAL_INFO.projectId} project, add a new column Description to the posts table`,
        expected: `
    I've verified that the Description column has been successfully added to the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Add column with different type
      {
        input: `in my ${EVAL_INFO.projectId} project, add view_count column to posts table`,
        expected: `
    I've verified that the view_count column has been successfully added to the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Rename column
      {
        input: `in my ${EVAL_INFO.projectId} project, rename the content column to body in posts table`,
        expected: `
    I've verified that the content column has been successfully renamed to body in the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Add index
      {
        input: `in my ${EVAL_INFO.projectId} project, create an index on title column in posts table`,
        expected: `
    I've verified that the index has been successfully created on the title column in the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Drop column
      {
        input: `in my ${EVAL_INFO.projectId} project, drop the content column from posts table`,
        expected: `
    I've verified that the content column has been successfully dropped from the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Alter column type
      {
        input: `in my ${EVAL_INFO.projectId} project, change the title column type to text in posts table`,
        expected: `
    I've verified that the data type of the title column has been successfully changed in the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Add boolean column
      {
        input: `in my ${EVAL_INFO.projectId} project, add is_published column to posts table`,
        expected: `
    I've verified that the is_published column has been successfully added to the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Add numeric column
      {
        input: `in my ${EVAL_INFO.projectId} project, add likes_count column to posts table`,
        expected: `
    I've verified that the likes_count column has been successfully added to the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },

      // Create index
      {
        input: `in my ${EVAL_INFO.projectId} project, create index on title column in posts table`,
        expected: `
    I've verified that the index has been successfully created on the title column in the posts table in a temporary branch. Would you like to commit the migration to the main branch?

    Migration Details:
    - Migration ID: <migration_id>
    - Temporary Branch Name: <temporary_branch_name>
    - Temporary Branch ID: <temporary_branch_id>
    - Migration Result: <migration_result>
    `,
      },
    ];
  },
  task: async (input, hooks) => {
    const databaseSchemaBeforeRun = await getMainBranchDatabaseSchema();
    hooks.metadata.databaseSchemaBeforeRun = databaseSchemaBeforeRun;

    const llmCallMessages = await evaluateTask(input);

    const databaseSchemaAfterRun = await getMainBranchDatabaseSchema();
    hooks.metadata.databaseSchemaAfterRun = databaseSchemaAfterRun;
    hooks.metadata.llmCallMessages = llmCallMessages;

    deleteNonDefaultBranches(EVAL_INFO.projectId);

    const finalMessage = llmCallMessages[llmCallMessages.length - 1];
    return finalMessage.content;
  },
  trialCount: 20,
  maxConcurrency: 2,
  scores: [factualityAnthropic, mainBranchIntegrityCheck],
});

Reporter('Prepare Database Migration Reporter', {
  reportEval: async (evaluator, result, { verbose, jsonl }) => {
    const { results, summary } = result;
    const failingResults = results.filter(
      (r: { error: unknown }) => r.error !== undefined,
    );

    if (failingResults.length > 0) {
      reportFailures(evaluator, failingResults, { verbose, jsonl });
    }

    console.log(jsonl ? JSON.stringify(summary) : summary);
    return failingResults.length === 0;
  },

  // cleanup branches after the run
  reportRun: async (evalReports) => {
    await deleteNonDefaultBranches(EVAL_INFO.projectId);

    return evalReports.every((r) => r);
  },
});
