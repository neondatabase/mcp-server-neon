import { resolveColumnMapping, formatDryRunResults, formatImportResults } from '../column-mapper.js';

describe('Column Mapper', () => {
  const mockTableSchema = {
    tableName: 'test_table',
    columns: [
      { name: 'id', dataType: 'INTEGER' },
      { name: 'name', dataType: 'TEXT' },
      { name: 'email', dataType: 'TEXT' },
      { name: 'user_age', dataType: 'INTEGER' }
    ]
  };

  test('should use provided column mapping if valid', () => {
    const csvHeaders = ['csv_id', 'full_name', 'contact_email', 'age'];
    const userMapping = {
      'csv_id': 'id',
      'full_name': 'name',
      'contact_email': 'email',
      'age': 'user_age'
    };
    
    const mapping = resolveColumnMapping(csvHeaders, mockTableSchema, userMapping);
    
    expect(mapping).toEqual(userMapping);
  });

  test('should throw error if user mapping references non-existent column', () => {
    const csvHeaders = ['csv_id', 'full_name', 'contact_email'];
    const userMapping = {
      'csv_id': 'id',
      'full_name': 'name',
      'contact_email': 'non_existent_column'
    };
    
    expect(() => {
      resolveColumnMapping(csvHeaders, mockTableSchema, userMapping);
    }).toThrow(/Table column "non_existent_column" doesn't exist/);
  });

  test('should auto-generate mapping based on column name similarity', () => {
    const csvHeaders = ['id', 'name', 'email', 'age'];
    
    const mapping = resolveColumnMapping(csvHeaders, mockTableSchema);
    
    expect(mapping.id).toBe('id');
    expect(mapping.name).toBe('name');
    expect(mapping.email).toBe('email');
    expect(mapping.age).toBe('user_age');
  });

  test('should match columns case-insensitively', () => {
    const csvHeaders = ['ID', 'NAME', 'email', 'AGE'];
    
    const mapping = resolveColumnMapping(csvHeaders, mockTableSchema);
    
    expect(mapping.ID).toBe('id');
    expect(mapping.NAME).toBe('name');
    expect(mapping.email).toBe('email');
    expect(mapping.AGE).toBe('user_age');
  });

  test('should format dry run results correctly', () => {
    const csvAnalysis = {
      recordCount: 3,
      headerRow: ['id', 'name', 'email', 'age', 'unused_column'],
      previewRows: [
        { id: '1', name: 'John', email: 'john@example.com', age: '30', unused_column: 'value' },
        { id: '2', name: 'Jane', email: 'jane@example.com', age: '25', unused_column: 'value' },
        { id: '3', name: 'Bob', email: 'bob@example.com', age: '42', unused_column: 'value' }
      ]
    };
    
    const columnMapping = {
      'id': 'id',
      'name': 'name',
      'email': 'email',
      'age': 'user_age'
    };
    
    const result = formatDryRunResults(csvAnalysis, columnMapping, 'test_table');
    
    expect(result).toContain('Dry run for importing to table "test_table"');
    expect(result).toContain('Found 3 records');
    expect(result).toContain('CSV: "id" → DB: "id"');
    expect(result).toContain('Unmapped columns');
    expect(result).toContain('unused_column');
    expect(result).toContain('This is a dry run');
  });

  test('should format import results correctly', () => {
    const importResults = {
      totalRows: 100,
      importedRows: 95,
      skippedRows: 2,
      errorRows: 3,
      executionTimeSeconds: 1.5,
      batches: [
        { batchNumber: 1, startRow: 1, endRow: 50, rowCount: 50, success: true },
        { batchNumber: 2, startRow: 51, endRow: 100, rowCount: 50, success: false, error: 'Some error' }
      ],
      startTime: Date.now() - 1500,
      endTime: Date.now()
    };
    
    const result = formatImportResults(importResults, 'test_table');
    
    expect(result).toContain('Import to table "test_table" completed');
    expect(result).toContain('Total records: 100');
    expect(result).toContain('Successfully imported: 95');
    expect(result).toContain('Skipped: 2');
    expect(result).toContain('Failed: 3');
    expect(result).toContain('Execution time: 1.50 seconds');
    expect(result).toContain('Total batches: 2');
    expect(result).toContain('Successful batches: 1');
    expect(result).toContain('Failed batches: 1');
    expect(result).toContain('Some error');
  });
});