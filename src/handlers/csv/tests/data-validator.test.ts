import { validateData, validateValueType, formatValidationResults } from '../data-validator.js';

describe('Data Validator', () => {
  const mockTableSchema = {
    tableName: 'test_table',
    columns: [
      {
        name: 'id',
        dataType: 'INTEGER',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: true
      },
      {
        name: 'name',
        dataType: 'TEXT',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: false
      },
      {
        name: 'email',
        dataType: 'TEXT',
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false
      },
      {
        name: 'age',
        dataType: 'INTEGER',
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false
      },
      {
        name: 'active',
        dataType: 'BOOLEAN',
        nullable: false,
        defaultValue: 'false',
        isPrimaryKey: false
      }
    ]
  };

  const mockCsvAnalysis = {
    headerRow: ['id', 'name', 'email', 'age', 'unknown_column'],
    rows: [
      { id: '1', name: 'John Doe', email: 'john@example.com', age: '30', unknown_column: 'value' },
      { id: '2', name: 'Jane Smith', email: '', age: 'not_a_number', unknown_column: 'value' },
      { id: '3', name: 'Bob Johnson', email: 'bob@example.com', age: '42', unknown_column: 'value' }
    ]
  };

  test('should validate data against schema correctly', () => {
    const columnMapping = {
      'id': 'id',
      'name': 'name',
      'email': 'email',
      'age': 'age'
    };

    const result = validateData(mockCsvAnalysis, columnMapping, mockTableSchema);
    
    // Should find errors with the age field not being a number
    expect(result.hasErrors).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    
    // Should have warning about unmapped column
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0].type).toBe('unmapped_columns');
    expect(result.warnings[0].columns).toContain('unknown_column');
  });

  test('should detect missing required columns', () => {
    const columnMapping = {
      'id': 'id',
      'email': 'email',
      'age': 'age'
      // Missing required 'name' column
    };

    const result = validateData(mockCsvAnalysis, columnMapping, mockTableSchema);
    
    expect(result.hasErrors).toBe(true);
    
    // Find the missing required columns error
    const missingColsError = result.errors.find(e => e.type === 'missing_required_columns');
    expect(missingColsError).toBeDefined();
    expect(missingColsError?.columns).toContain('name');
  });

  test('should validate value types correctly', () => {
    // Integer validation
    expect(validateValueType('123', 'INTEGER')).toBeNull();
    expect(validateValueType('12.3', 'INTEGER')).not.toBeNull();
    expect(validateValueType('text', 'INTEGER')).not.toBeNull();
    
    // Numeric validation
    expect(validateValueType('123.45', 'NUMERIC')).toBeNull();
    expect(validateValueType('123', 'NUMERIC')).toBeNull();
    expect(validateValueType('text', 'NUMERIC')).not.toBeNull();
    
    // Boolean validation
    expect(validateValueType('true', 'BOOLEAN')).toBeNull();
    expect(validateValueType('false', 'BOOLEAN')).toBeNull();
    expect(validateValueType('yes', 'BOOLEAN')).toBeNull();
    expect(validateValueType('no', 'BOOLEAN')).toBeNull();
    expect(validateValueType('1', 'BOOLEAN')).toBeNull();
    expect(validateValueType('0', 'BOOLEAN')).toBeNull();
    expect(validateValueType('maybe', 'BOOLEAN')).not.toBeNull();
    
    // Date validation
    expect(validateValueType('2023-01-15', 'DATE')).toBeNull();
    expect(validateValueType('01/15/2023', 'DATE')).toBeNull();
    expect(validateValueType('not a date', 'DATE')).not.toBeNull();
    
    // Text validation (always passes)
    expect(validateValueType('any text', 'TEXT')).toBeNull();
    expect(validateValueType('123', 'TEXT')).toBeNull();
  });

  test('should format validation results correctly', () => {
    const validationResults = {
      hasErrors: true,
      errors: [
        {
          type: 'missing_required_columns',
          message: 'Missing required columns: name',
          columns: ['name']
        },
        {
          row: 2,
          errors: [
            {
              column: 'age',
              targetColumn: 'age',
              message: 'Value "not_a_number" is not a valid integer'
            }
          ]
        }
      ],
      warnings: [
        {
          type: 'unmapped_columns',
          message: 'The following CSV columns will not be imported: unknown_column',
          columns: ['unknown_column']
        }
      ],
      mapping: { 'id': 'id', 'email': 'email', 'age': 'age' }
    };
    
    const result = formatValidationResults(validationResults, 'test_table');
    
    expect(result).toContain('Validation results for importing to table "test_table"');
    expect(result).toContain('Missing required columns');
    expect(result).toContain('Row 2');
    expect(result).toContain('not a valid integer');
    expect(result).toContain('The following CSV columns will not be imported');
  });
});