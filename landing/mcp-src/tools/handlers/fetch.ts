import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Api, MemberWithUser, ProjectListItem } from "@neondatabase/api-client";
import { fetchInputSchema } from "../toolsSchema";
import { z } from "zod";
import { handleDescribeProject } from "./decribe-project";
import { handleDescribeBranch } from "./describe-branch";
import { ToolHandlerExtraParams } from "../types";
import { generateConsoleUrl, CONSOLE_URLS } from "./urls";

type FetchProps = z.infer<typeof fetchInputSchema>;

export async function handleFetch(
  { id }: FetchProps,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  try {
    // Parse the ID format
    if (id.startsWith("org:") || id.startsWith("org-")) {
      return await fetchOrganizationDetails(id.slice(4), neonClient);
    } else if (id.startsWith("branch:")) {
      const [projectId, branchId] = id.slice(7).split("/");
      return await fetchBranchDetails(projectId, branchId, neonClient, extra);
    } else if (id.startsWith("project:")) {
      return await fetchProjectDetails(id.slice(8), neonClient);
    } else {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid ID format: "${id}". Expected format: org:*, project:*, or branch:*`,
          },
        ],
      };
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to fetch details: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

async function fetchOrganizationDetails(
  orgId: string,
  neonClient: Api<unknown>,
): Promise<CallToolResult> {
  try {
    const { data: orgData } = await neonClient.getOrganization(orgId);

    let members: MemberWithUser[] = [];
    try {
      const { data: membersData } =
        await neonClient.getOrganizationMembers(orgId);
      members = membersData.members || [];
    } catch {
      // Skip if we can't access members
    }

    // Get projects count in this organization
    let projects: ProjectListItem[] = [];
    try {
      const { data: projectsData } = await neonClient.listProjects({
        org_id: orgId,
      });
      projects = projectsData.projects || [];
    } catch {
      // Skip if we can't access projects
    }

    const details = {
      organization: {
        id: orgData.id,
        name: orgData.name,
        created_at: orgData.created_at,
        updated_at: orgData.updated_at,
      },
      console_url: generateConsoleUrl(CONSOLE_URLS.ORGANIZATION, {
        orgId: orgData.id,
      }),
    };

    return {
      content: [
        {
          type: "text",
          text: `**Organization Details**
**Basic Information:**
- Name: ${details.organization.name}
- ID: ${details.organization.id}
- Created: ${new Date(details.organization.created_at).toLocaleDateString()}

**Statistics:**
${members.length > 0 ? `- Members: ${members.length}` : undefined}
- Projects: ${projects.length}

**Raw Data:**
${JSON.stringify({ org: orgData, members, projects }, null, 2)}
`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to fetch organization details: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

async function fetchProjectDetails(
  projectId: string,
  neonClient: Api<unknown>,
): Promise<CallToolResult> {
  try {
    const { project, branches } = await handleDescribeProject(
      projectId,
      neonClient,
    );

    const defaultBranch = branches.find((branch) => branch.default);
    return {
      content: [
        {
          type: "text",
          text: `**Project Details**

**Basic Information:**
- Name: ${project.name}
- ID: ${project.id}
- Region: ${project.region_id}
- PostgreSQL Version: ${project.pg_version}
- Created: ${new Date(project.created_at).toLocaleDateString()}
- Last Updated: ${new Date(project.updated_at).toLocaleDateString()}

**Statistics:**
- Branches: ${branches.length}
- Default Branch: ${defaultBranch?.name} (${defaultBranch?.id})

**Raw Data:**
${JSON.stringify({ project, branches }, null, 2)}
`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to fetch project details: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

async function fetchBranchDetails(
  projectId: string,
  branchId: string,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  try {
    const result = await handleDescribeBranch(
      {
        projectId,
        branchId,
      },
      neonClient,
      extra,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to fetch branch details: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}
