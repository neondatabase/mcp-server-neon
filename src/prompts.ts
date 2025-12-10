import { z } from 'zod';
import { fetchRawGithubContent } from './resources.js';

export const setupNeonAuthViteReactArgsSchema = {
  projectId: z
    .string()
    .optional()
    .describe(
      'Optional Neon project ID. If not provided, the guide will help discover available projects.',
    ),
  branchId: z
    .string()
    .optional()
    .describe(
      'Optional branch ID. If not provided, the default branch will be used.',
    ),
  databaseName: z
    .string()
    .optional()
    .describe(
      'Optional database name. If not provided, the default database (neondb) will be used.',
    ),
} as const;

export const NEON_PROMPTS = [
  {
    name: 'setup-neon-auth',
    description:
      'Interactive guide for setting up Neon Auth in a Vite+React project. Walks through provisioning, package installation, client setup, and UI components.',
    argsSchema: setupNeonAuthViteReactArgsSchema,
  },
] as const;

const COMMON_FOLLOW_INSTRUCTIONS = `

# Just-in-Time Context Protocol

## 1. ASSESSMENT & TRIGGER
- **Analyze Gaps:** Before generating code, ask: "Do I have the *exact* API signatures and patterns for this specific task in my context?"
- **Lazy Loading:** Do NOT read external links or docs if the current context is sufficient.
- **Trigger:** IF you lack specific details AND a reference link/path exists in the rules (e.g., \`[Full Setup](url)\`), you MUST fetch that resource immediately.

## 2. STRICT LINK OBEDIENCE
- **No Guessing:** If a task relates to a linked topic (e.g., "Styling"), you are PROHIBITED from inferring patterns. You must read the linked reference.
- **Method:**
   - For URLs: Use \`@Web\` to read the specific page.
   - For Paths: Use \`read_file\` or search \`@Doc\`.

## 3. EXECUTION
- **State Intent:** Briefly confirm: "Fetching [Topic] details from [Source]..."
- **Apply & Discard:** Extract only what is needed for the current task.

## ENFORCEMENT
⚠️ You MUST follow these rules. If you skip documentation lookup, you are breaking protocol.
`;

export const getPromptTemplate = async (
  promptName: string,
  args?: Record<string, string>,
): Promise<string> => {
  if (promptName === 'setup-neon-auth') {
    // Variables are available for future template interpolation
    void args?.projectId;
    void args?.branchId;
    void args?.databaseName;

    const content = await fetchRawGithubContent(
      '/neondatabase-labs/ai-rules/main/mcp-prompts/neon-auth-setup.md',
    );

    return `\`\`\`markdown\n
    To follow the instructions bellow you will need to use Curl or Web tool so you can follow the links.
    
    

    
    
    ${content}\`\`\``;
  }

  throw new Error(`Unknown prompt: ${promptName}`);
};
