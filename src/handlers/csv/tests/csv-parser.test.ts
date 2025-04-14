import { analyzeCSV } from '../csv-parser.js'; // CsvAnalysisResult

describe('CSV Parser', () => {
  test('should parse basic CSV with header row', async () => {
    const csv = `name,age,email
John Doe,30,john@example.com
Jane Smith,25,jane@example.com
Bob Johnson,42,bob@example.com`;

    const result = await analyzeCSV(csv);

    expect(result.recordCount).toBe(3);
    expect(result.headerRow).toEqual(['name', 'age', 'email']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].name).toBe('John Doe');
    expect(result.rows[0].age).toBe('30');
    expect(result.columnAnalysis.length).toBe(3);
  });

  test('should handle CSV without header row', async () => {
    const csv = `John Doe,30,john@example.com
Jane Smith,25,jane@example.com
Bob Johnson,42,bob@example.com`;

    const result = await analyzeCSV(csv, { hasHeaderRow: false });

    expect(result.recordCount).toBe(3);
    expect(result.headerRow).toEqual(['column_1', 'column_2', 'column_3']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0].column_1).toBe('John Doe');
  });

  test('should correctly infer column types', async () => {
    const csv = `id,name,age,is_active,created_at,amount
1,John Doe,30,true,2023-01-15T14:30:00Z,150.50
2,Jane Smith,25,false,2023-02-20T09:15:00Z,200.75
3,Bob Johnson,42,true,2023-03-10T11:45:00Z,75.25`;

    const result = await analyzeCSV(csv);

    const columnTypes = result.columnAnalysis.reduce<Record<string, string>>(
      (acc, col) => {
        acc[col.name] = col.inferred.type;
        return acc;
      },
      {},
    );

    expect(columnTypes.id).toBe('integer');
    expect(columnTypes.name).toBe('text');
    expect(columnTypes.age).toBe('integer');
    expect(columnTypes.is_active).toBe('boolean');
    expect(columnTypes.created_at).toBe('timestamp');
    expect(columnTypes.amount).toBe('numeric');
  });

  test('should handle custom delimiters', async () => {
    const csv = `name;age;email
John Doe;30;john@example.com
Jane Smith;25;jane@example.com
Bob Johnson;42;bob@example.com`;

    const result = await analyzeCSV(csv, { delimiter: ';' });

    expect(result.recordCount).toBe(3);
    expect(result.headerRow).toEqual(['name', 'age', 'email']);
    expect(result.rows[0].name).toBe('John Doe');
  });

  test('should detect primary key candidates', async () => {
    const csv = `id,name,email
1,John Doe,john@example.com
2,Jane Smith,jane@example.com
3,Bob Johnson,bob@example.com`;

    const result = await analyzeCSV(csv);

    // Should identify 'id' as a primary key candidate
    expect(result.primaryKeyCandidate).toBe('id');
  });

  test('should handle quoted fields with delimiters', async () => {
    const csv = `name,description,price
"Product 1","This is a, product with comma",10.99
"Product 2","Another, product, with commas",20.50`;

    const result = await analyzeCSV(csv);

    expect(result.rows[0].description).toBe('This is a, product with comma');
    expect(result.rows[1].description).toBe('Another, product, with commas');
  });

  test('should handle empty fields', async () => {
    const csv = `name,age,email
John Doe,30,
Jane Smith,,jane@example.com
,,`;

    const result = await analyzeCSV(csv);

    expect(result.rows[0].email).toBe('');
    expect(result.rows[1].age).toBe('');
    expect(result.rows[2].name).toBe('');
    expect(result.rows[2].age).toBe('');
    expect(result.rows[2].email).toBe('');
  });

  test('should throw error for empty CSV', async () => {
    const csv = '';

    await expect(analyzeCSV(csv)).rejects.toThrow('CSV file is empty');
  });
});
