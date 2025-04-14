import crypto from 'crypto';
import { z } from 'zod';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { importCsvDataInputSchema } from '../../toolsSchema.js';

import { analyzeCSV } from './csv-parser.js'
import { 
  generateTableSchema, 
  formatSchemaProposal 
} from './schema-generator.js';
import { 
  checkTableExists, 
  createTable, 
  getTableSchema, 
  executeImport 
} from './db-operations.js';
import { 
  validateData, 
  formatValidationResults 
} from './data-validator.js';
import { 
  resolveColumnMapping, 
  formatDryRunResults, 
  formatImportResults 
} from './column-mapper.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Type for the request parameters
type Props = z.infer<typeof importCsvDataInputSchema>;

// In-memory storage for uploaded CSV files with 30-minute expiration
const csvStorage = new Map<
  string,
  { content: string; timestamp: number; filename: string }
>();

// Clean up expired uploads every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of csvStorage.entries()) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        // 30 minutes
        csvStorage.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);


/**
 * Handler for CSV file uploads
 */
export const handleCsvUpload: ReadResourceCallback = (url: URL, extra: RequestHandlerExtra) => {
  // Generate a unique ID for this upload
  const uploadId = crypto.randomUUID();
  const filename = url.searchParams.get('filename') || 'uploaded.csv';
  
  // Note: In the actual implementation, we would need to handle how the MCP 
  // passes the file content to this handler. Right now I'm simulating with a placeholder.
  
  // Store a placeholder content (in production, this would be the actual file content)
  const csvContent = "This is where the actual CSV content would be stored";
  storeCsvContent(uploadId, csvContent, filename);
  
  // Return in the format expected by ReadResourceCallback
  return {
    contents: [
      {
        uri: `csv-upload:${uploadId}`,
        mimeType: 'text/csv',
        text: JSON.stringify({
          uploadId,
          filename,
          size: csvContent.length,
          timestamp: new Date().toISOString(),
          extra
        })
      }
    ]
  };
};

/**
 * Store uploaded CSV content in memory
 */
export function storeCsvContent(
  uploadId: string,
  content: string,
  filename = 'uploaded.csv',
): void {
  csvStorage.set(uploadId, {
    content,
    timestamp: Date.now(),
    filename,
  });
}

/**
 * Retrieve CSV content by upload ID
 */
export function retrieveCsvContent(uploadId: string): string | null {
  const upload = csvStorage.get(uploadId);
  if (!upload) return null;

  // Check if upload has expired (30 minutes)
  if (Date.now() - upload.timestamp > 30 * 60 * 1000) {
    csvStorage.delete(uploadId);
    return null;
  }

  return upload.content;
}

/**
 * Main handler for CSV import functionality
 */
export async function handleImportCsvData(params: Props): Promise<CallToolResult> {
  try {
    const { projectId, databaseName, tableName, branchId, csvSource, options } =
      params;

    // 1. Retrieve CSV content from the source
    let csvData;
    if (csvSource.type === 'direct') {
      csvData = csvSource.data;
    } else {
      csvData = retrieveCsvContent(csvSource.uploadId);
      if (!csvData) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Failed to retrieve CSV data. The upload may be missing or expired.',
            },
          ],
        };
      }
    }

    // 2. Parse and analyze the CSV data
    const csvAnalysis = await analyzeCSV(csvData, options);

    // 3. Check if the target table exists
    const tableExists = await checkTableExists(
      projectId,
      branchId,
      databaseName,
      tableName,
    );

    // 4. Handle table creation if necessary
    if (!tableExists) {
      const proposedSchema = generateTableSchema(
        csvAnalysis.columnAnalysis,
        csvAnalysis.primaryKeyCandidate
      );

      if (!options.autoCreateTable) {
        // Return schema proposal for user confirmation if auto-create is not enabled
        return {
          content: [
            {
              type: 'text',
              text: formatSchemaProposal(
                tableName,
                proposedSchema,
                csvAnalysis,
              ),
            },
          ],
        };
      }

      // Create the table with the proposed schema
      const createResult = await createTable(
        projectId,
        branchId,
        databaseName,
        tableName,
        proposedSchema,
      );
      
      if (!createResult.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to create table: ${createResult.error}`,
            },
          ],
        };
      }

      if (options.createOnly) {
        return {
          content: [
            {
              type: 'text',
              text: `Table '${tableName}' successfully created. Import skipped as requested.`,
            },
          ],
        };
      }
    }

    // 5. Get the table schema for mapping and validation
    const tableSchema = await getTableSchema(
      projectId,
      branchId,
      databaseName,
      tableName,
    );

    // 6. Determine column mapping (either from options or auto-generate)
    const columnMapping = resolveColumnMapping(
      csvAnalysis.headerRow,
      tableSchema,
      options.columnMapping,
    );

    // 7. Validate the first batch of data against the schema
    const validationResults = validateData(
      csvAnalysis,
      columnMapping,
      tableSchema,
    );

    if (validationResults.hasErrors) {
      return {
        content: [
          {
            type: 'text',
            text: formatValidationResults(validationResults, tableName),
          },
        ],
      };
    }

    // 8. If this is a dry run, return preview without importing
    if (options.dryRun) {
      return {
        content: [
          {
            type: 'text',
            text: formatDryRunResults(csvAnalysis, columnMapping, tableName),
          },
        ],
      };
    }

    // 9. Execute the import in batches
    const importResults = await executeImport(
      projectId,
      branchId,
      databaseName,
      tableName,
      csvAnalysis.rows,
      columnMapping,
      options,
    );

    // 10. Return summary of the import
    return {
      content: [
        {
          type: 'text',
          text: formatImportResults(importResults, tableName),
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Import failed: ${error.message}`,
        },
      ],
    };
  }
}

