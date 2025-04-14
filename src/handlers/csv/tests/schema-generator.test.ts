import { 
    generateTableSchema, 
    sanitizeColumnName, 
    mapToPostgresType, 
    formatSchemaProposal 
  } from '../schema-generator.js';
  import { ColumnAnalysis } from '../csv-parser.js';
  
  describe('Schema Generator', () => {
    const mockColumnAnalysis: ColumnAnalysis[] = [
      {
        name: 'id',
        inferred: { type: 'integer' },
        nonNullPercentage: 100,
        uniquePercentage: 100,
        examples: [1, 2, 3]
      },
      {
        name: 'name with spaces',
        inferred: { type: 'text' },
        nonNullPercentage: 100,
        uniquePercentage: 90,
        examples: ['John', 'Jane', 'Bob']
      },
      {
        name: 'email',
        inferred: { type: 'text' },
        nonNullPercentage: 80,
        uniquePercentage: 100,
        examples: ['john@example.com', 'jane@example.com']
      },
      {
        name: 'created_at',
        inferred: { type: 'timestamp' },
        nonNullPercentage: 70,
        uniquePercentage: 75,
        examples: ['2023-01-01T00:00:00Z']
      }
    ];
  
    test('should generate correct table schema', () => {
      const schema = generateTableSchema(mockColumnAnalysis, 'id');
      
      expect(schema.columns.length).toBe(4);
      
      // Check primary key
      const idColumn = schema.columns.find(col => col.name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn?.isPrimaryKey).toBe(true);
      expect(idColumn?.nullable).toBe(false);
      
      // Check sanitized name
      const nameColumn = schema.columns.find(col => col.name === 'name_with_spaces');
      expect(nameColumn).toBeDefined();
      expect(nameColumn?.nullable).toBe(false);
      
      // Check nullable column
      const emailColumn = schema.columns.find(col => col.name === 'email');
      expect(emailColumn).toBeDefined();
      expect(emailColumn?.nullable).toBe(true);
      
      // Check data types
      expect(idColumn?.dataType).toBe('INTEGER');
      expect(nameColumn?.dataType).toBe('TEXT');
      expect(emailColumn?.dataType).toBe('TEXT');
    });
  
    test('should sanitize column names correctly', () => {
      expect(sanitizeColumnName('column name')).toBe('column_name');
      expect(sanitizeColumnName('Column-With_Special@#$Chars')).toBe('column_with_special___chars');
      expect(sanitizeColumnName('123startWithNumber')).toBe('col_123startwithnumber');
      expect(sanitizeColumnName(' spaces around ')).toBe('spaces_around');
    });
  
    test('should map inferred types to PostgreSQL types', () => {
      expect(mapToPostgresType('integer')).toBe('INTEGER');
      expect(mapToPostgresType('bigint')).toBe('BIGINT');
      expect(mapToPostgresType('numeric')).toBe('NUMERIC');
      expect(mapToPostgresType('date')).toBe('DATE');
      expect(mapToPostgresType('timestamp')).toBe('TIMESTAMP');
      expect(mapToPostgresType('boolean')).toBe('BOOLEAN');
      expect(mapToPostgresType('text')).toBe('TEXT');
      expect(mapToPostgresType('unknown_type')).toBe('TEXT');
    });
  
    test('should format schema proposal for display', () => {
      const schema = generateTableSchema(mockColumnAnalysis, 'id');
      const mockCsvAnalysis = {
        recordCount: 3,
        headerRow: ['id', 'name with spaces', 'email', 'created_at'],
        previewRows: [
          { id: '1', 'name with spaces': 'John', email: 'john@example.com', created_at: '2023-01-01' },
          { id: '2', 'name with spaces': 'Jane', email: 'jane@example.com', created_at: '2023-02-01' },
        ],
        rows: Array(3).fill({})
      };
      
      const result = formatSchemaProposal('test_table', schema, mockCsvAnalysis);
      
      expect(result).toContain('test_table');
      expect(result).toContain('Primary Key');
      expect(result).toContain('id: INTEGER');
      expect(result).toContain('name_with_spaces: TEXT');
      expect(result).toContain('NOT NULL');
    });
  });