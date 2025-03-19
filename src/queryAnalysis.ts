interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Schema'?: string;
  Plans?: PlanNode[];
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Scan Type'?: string;
  'Total Cost'?: number;
  [key: string]: any;
}

interface TableSchema {
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    default?: string;
    description?: string;
  }[];
  indexes: {
    name: string;
    definition: string;
    size: string;
  }[];
  constraints: {
    name: string;
    type: string;
    definition: string;
  }[];
  size: {
    total_size: string;
    table_size: string;
    index_size: string;
  };
}

export function extractTableNamesFromPlan(planResult: any): string[] {
  const plan = planResult?.content?.[0]?.text;
  if (!plan) return [];

  try {
    const planJson = JSON.parse(plan);
    const queryPlan = planJson[0]?.['QUERY PLAN']?.[0]?.Plan;
    if (!queryPlan) return [];

    const tableNames = new Set<string>();
    
    function extractFromNode(node: PlanNode) {
      if (node['Relation Name'] && node['Schema']) {
        // Create fully qualified table name: schema.table
        const fullyQualifiedName = `${node['Schema']}.${node['Relation Name']}`;
        tableNames.add(fullyQualifiedName);
      }
      if (node.Plans) {
        node.Plans.forEach(extractFromNode);
      }
    }

    extractFromNode(queryPlan);
    return Array.from(tableNames);
  } catch (error) {
    console.error('Error parsing plan:', error);
    return [];
  }
}

export function analyzePlanAndGenerateSuggestions(
  planResult: any,
  tableSchemas: any[],
): string[] {
  const plan = planResult?.content?.[0]?.text;
  if (!plan) return [];

  try {
    const planJson = JSON.parse(plan);
    const planNode = planJson[0]?.['QUERY PLAN']?.[0]?.Plan;
    if (!planNode) return [];

    const suggestions: string[] = [];
    const analyzedTables = new Map<string, TableSchema>();

    // Parse table schemas
    tableSchemas.forEach((schema) => {
      try {
        const schemaContent = JSON.parse(schema.content[0].text);
        analyzedTables.set(schema.tableName, schemaContent);
      } catch (error) {
        console.error('Error parsing table schema:', error);
      }
    });

    function analyzeNode(node: PlanNode) {
      // Analyze sequential scans
      if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] && node['Schema']) {
        const tableName = `${node['Schema']}.${node['Relation Name']}`;
        const tableSchema = analyzedTables.get(tableName);
        
        if (tableSchema) {
          // Analyze filter conditions for potential indexes
          if (node.Filter) {
            const filterColumns = extractColumnsFromFilter(node.Filter);
            const existingIndexes = tableSchema.indexes;
            
            // Check if we have appropriate indexes for the filter columns
            const missingIndexes = filterColumns.filter(column => 
              !existingIndexes.some(idx => idx.definition.includes(column))
            );

            if (missingIndexes.length > 0) {
              suggestions.push(
                `CREATE INDEX ON ${tableName} (${missingIndexes.join(', ')})`
              );
            }
          }
        }
      }

      // Analyze index scans for efficiency
      if (node['Node Type'].includes('Index Scan') && node['Index Name']) {
        const tableName = node['Schema'] && node['Relation Name'] ? 
          `${node['Schema']}.${node['Relation Name']}` : undefined;
        if (!tableName) return;
        
        const tableSchema = analyzedTables.get(tableName);
        
        if (tableSchema) {
          // Check if the index is being used efficiently
          if (node['Index Cond'] && node['Filter']) {
            suggestions.push(
              `Consider modifying index ${node['Index Name']} to include filter conditions`
            );
          }
        }
      }

      // Note: Removed automatic ANALYZE suggestions as they should be handled by maintenance jobs

      // Recursively analyze child nodes
      if (node.Plans) {
        node.Plans.forEach(analyzeNode);
      }
    }

    analyzeNode(planNode);

    // Add suggestions for general optimizations
    if (planNode['Total Cost'] > 1000) {
      suggestions.push('Consider adding LIMIT clause if full result set is not needed');
    }

    return suggestions;
  } catch (error) {
    console.error('Error analyzing plan:', error);
    return [];
  }
}

function extractColumnsFromFilter(filter: string | undefined): string[] {
  if (!filter) return [];
  
  // Simple regex to extract column names from filter conditions
  const columnRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*[=<>!]/g;
  const matches = filter.match(columnRegex);
  return matches ? matches.map(m => m.replace(/[=<>!]$/, '').trim()) : [];
} 