import { parse } from 'csv-parse';
import { Readable } from 'stream';

export type CsvParserOptions = {
  hasHeaderRow?: boolean;
  delimiter?: string;
  quoteChar?: string;
  escapeChar?: string;
  newline?: string;
  sampleSize?: number;
};

export type CsvAnalysisResult = {
  recordCount: number;
  headerRow: string[];
  rows: Record<string, any>[];
  columnAnalysis: ColumnAnalysis[];
  primaryKeyCandidate: string | null;
  previewRows: Record<string, any>[];
};

export type ColumnAnalysis = {
  name: string;
  inferred: {
    type: string;
  };
  nonNullPercentage: number;
  uniquePercentage: number;
  examples: any[];
};

/**
 * Analyzes a CSV string and returns detailed information about its structure and data
 * 
 * @param csvData The CSV content as a string
 * @param options Configuration options for parsing
 * @returns Promise resolving to analysis results including column types, statistics, and preview
 */
export async function analyzeCSV(
  csvData: string,
  options: CsvParserOptions = {}
): Promise<CsvAnalysisResult> {
  const {
    hasHeaderRow = true,
    delimiter = ',',
    quoteChar = '"',
    escapeChar = '"',
    // newline = '\n',
    sampleSize = 100
  } = options;

  const parseOptions = {
    delimiter,
    quote: quoteChar,
    escape: escapeChar,
    columns: hasHeaderRow,
    skip_empty_lines: true,
    trim: true
  };

  return new Promise((resolve, reject) => {
    const rows: Record<string, any>[] = [];
    let headerRow: string[] = [];
    
    const parser = parse(parseOptions);
    
    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        if (rows.length === 0 && !hasHeaderRow) {
          // Create default headers for headerless CSV
          headerRow = Object.keys(record).map((_, i) => `column_${i + 1}`);
          
          // Convert array to object with generated headers
          const mappedRecord: Record<string, any> = {};
          Object.values(record).forEach((value, index) => {
            mappedRecord[headerRow[index]] = value;
          });
          rows.push(mappedRecord);
        } else {
          if (rows.length === 0 && hasHeaderRow) {
            headerRow = Object.keys(record);
          }
          rows.push(record);
        }
      }
    });
    
    parser.on('error', (err) => {
      reject(new Error(`CSV parsing error: ${err.message}`));
    });
    
    parser.on('end', () => {
      if (rows.length === 0) {
        reject(new Error('CSV file is empty or improperly formatted'));
        return;
      }

      // Sample rows for analysis (up to sample size)
      const sampleRows = rows.slice(0, Math.min(rows.length, sampleSize));
      
      // Analyze columns
      const columnAnalysis = headerRow.map(header => {
        const values = sampleRows.map(row => row[header]);
        return {
          name: header,
          inferred: inferColumnProperties(values),
          nonNullPercentage: calculateNonNullPercentage(values),
          uniquePercentage: calculateUniquePercentage(values),
          examples: values.slice(0, 3).filter(v => v !== null && v !== '')
        };
      });
      
      // Identify potential primary key
      const primaryKeyCandidate = identifyPrimaryKeyCandidate(columnAnalysis);
      
      resolve({
        recordCount: rows.length,
        headerRow,
        rows,
        columnAnalysis,
        primaryKeyCandidate,
        previewRows: rows.slice(0, 5) // First 5 rows for preview
      });
    });
    
    // Feed the parser with the CSV data
    const stream = Readable.from([csvData]);
    stream.pipe(parser);
  });
}

/**
 * Infer column data types from sample values
 */
function inferColumnProperties(values: any[]): { type: string } {
  // Remove null/empty values for type detection
  const nonEmptyValues = values.filter(v => v !== null && v !== '');
  if (nonEmptyValues.length === 0) return { type: 'text' };

  // Check for numeric values
  const numericCount = nonEmptyValues.filter(v => !isNaN(Number(v))).length;
  if (numericCount === nonEmptyValues.length) {
    // Check if all are integers
    const integerCount = nonEmptyValues.filter(v => Number.isInteger(Number(v))).length;
    if (integerCount === nonEmptyValues.length) {
      // Check value ranges for appropriate int type
      const maxVal = Math.max(...nonEmptyValues.map(v => Number(v)));
      return { type: maxVal > 2147483647 ? 'bigint' : 'integer' };
    }
    return { type: 'numeric' };
  }

  // Check for date formats
  const dateCount = nonEmptyValues.filter(v => isValidDate(v)).length;
  if (dateCount === nonEmptyValues.length) {
    return { type: 'date' };
  }

  // Check for timestamp formats
  const timestampCount = nonEmptyValues.filter(v => isValidTimestamp(v)).length;
  if (timestampCount === nonEmptyValues.length) {
    return { type: 'timestamp' };
  }

  // Check for boolean values
  const boolStrings = ['true', 'false', 'yes', 'no', 't', 'f', 'y', 'n', '1', '0'];
  const boolCount = nonEmptyValues.filter(v => boolStrings.includes(String(v).toLowerCase())).length;
  if (boolCount === nonEmptyValues.length) {
    return { type: 'boolean' };
  }

  // Default to text
  return { type: 'text' };
}

/**
 * Check if a string represents a valid date
 */
function isValidDate(value: string): boolean {
  if (typeof value !== 'string') return false;

  // Check common date formats: YYYY-MM-DD, MM/DD/YYYY, DD-MM-YYYY
  const dateRegexes = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    /^\d{1,2}-\d{1,2}-\d{4}$/,
  ];

  if (!dateRegexes.some(regex => regex.test(value))) return false;

  // Try parsing the date
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Check if a string represents a valid timestamp
 */
function isValidTimestamp(value: string): boolean {
  if (typeof value !== 'string') return false;

  // Check common timestamp formats
  const timestampRegexes = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/,
  ];

  if (!timestampRegexes.some(regex => regex.test(value))) return false;

  // Try parsing the timestamp
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Calculate percentage of non-null values in a column
 */
function calculateNonNullPercentage(values: any[]): number {
  if (values.length === 0) return 0;
  const nonNullCount = values.filter(v => v !== null && v !== '').length;
  return (nonNullCount / values.length) * 100;
}

/**
 * Calculate percentage of unique values in a column
 */
function calculateUniquePercentage(values: any[]): number {
  if (values.length === 0) return 0;
  const uniqueValues = new Set(values.map(v => v?.toString()));
  return (uniqueValues.size / values.length) * 100;
}

/**
 * Identify the most likely primary key column
 */
function identifyPrimaryKeyCandidate(columnAnalysis: ColumnAnalysis[]): string | null {
  // First look for columns named 'id', 'key', etc.
  const idColumnCandidates = columnAnalysis.filter(col => /^(id|key|.*_id|.*_key)$/i.test(col.name));

  if (idColumnCandidates.length > 0) {
    // Find the id column with highest uniqueness
    const bestIdColumn = idColumnCandidates.reduce(
      (best, current) => current.uniquePercentage > best.uniquePercentage ? current : best,
      idColumnCandidates[0]
    );

    // If it's reasonably unique, use it
    if (bestIdColumn.uniquePercentage > 95) {
      return bestIdColumn.name;
    }
  }

  // Look for any column with high uniqueness
  const uniqueCandidates = columnAnalysis.filter(col => col.uniquePercentage > 95);
  if (uniqueCandidates.length > 0) {
    // Prefer numeric columns
    const numericUnique = uniqueCandidates.filter(
      col => col.inferred.type === 'integer' || col.inferred.type === 'bigint'
    );

    if (numericUnique.length > 0) {
      return numericUnique[0].name;
    }

    return uniqueCandidates[0].name;
  }

  return null;
}