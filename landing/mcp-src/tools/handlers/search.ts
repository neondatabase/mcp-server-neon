import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Api, Organization, ProjectListItem } from "@neondatabase/api-client";
import { Branch } from "@neondatabase/api-client";
import { searchInputSchema } from "../toolsSchema";
import { z } from "zod";
import { ToolHandlerExtraParams } from "../types";
import { handleListProjects } from "./list-projects";
import { CONSOLE_URLS, generateConsoleUrl } from "./urls";

type SearchProps = z.infer<typeof searchInputSchema>;

type MCPOrgId = `org:${string}`;
type MCPProjectId = `project:${string}`;
type MCPBranchId = `branch:${string}/${string}`; // projectId/branchId
type SearchResultId = MCPOrgId | MCPProjectId | MCPBranchId;

type SearchResult = {
  id: SearchResultId;
  title: string;
  url: string;
  type: "organization" | "project" | "branch";
};

const matches = (
  entity: Organization | ProjectListItem | Branch,
  query: string,
) => {
  return (
    entity.name.toLowerCase().includes(query) ||
    entity.id.toLowerCase().includes(query)
  );
};

export async function handleSearch(
  { query }: SearchProps,
  neonClient: Api<unknown>,
  extra: ToolHandlerExtraParams,
): Promise<CallToolResult> {
  try {
    const results: SearchResult[] = [];
    const searchQuery = query.toLowerCase();
    // Search through all user's organizations
    let organizations;
    if (extra.account.isOrg) {
      const orgId = extra.account.id;
      const { data } = await neonClient.getOrganization(orgId);
      organizations = [data];
    } else {
      const { data: response } = await neonClient.getCurrentUserOrganizations();
      organizations = response.organizations || [];
    }

    // If in personal account, search projects
    if (!extra.account.isOrg) {
      const projects = await handleListProjects(
        {
          limit: 400,
        },
        neonClient,
        extra,
      );
      const searchResults = await searchProjectsAndBranches(
        projects,
        neonClient,
        searchQuery,
      );

      results.push(...searchResults);
    }

    // Search in all organizations
    for (const org of organizations) {
      // Check if organization matches the search query
      if (matches(org, searchQuery)) {
        results.push({
          id: `org:${org.id}`,
          title: org.name,
          url: generateConsoleUrl(CONSOLE_URLS.ORGANIZATION, {
            orgId: org.id,
          }),
          type: "organization",
        });
      }

      try {
        const projects = await handleListProjects(
          {
            org_id: org.id,
            limit: 400,
          },
          neonClient,
          extra,
        );

        const searchResults = await searchProjectsAndBranches(
          projects,
          neonClient,
          searchQuery,
        );

        results.push(...searchResults);
      } catch {
        // Skip projects if we can't access them
        continue;
      }
    }

    // Also search shared projects
    try {
      const { data } = await neonClient.listSharedProjects({
        limit: 400,
      });

      const searchResults = await searchProjectsAndBranches(
        data.projects,
        neonClient,
        searchQuery,
      );
      results.push(...searchResults);
    } catch {
      // Skip shared projects if we can't access them
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to search: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}

const searchProjectsAndBranches = async (
  projects: ProjectListItem[],
  neonClient: Api<unknown>,
  query: string,
): Promise<SearchResult[]> => {
  const results: SearchResult[] = [];
  projects.forEach((project) => {
    if (matches(project, query)) {
      results.push({
        id: `project:${project.id}`,
        title: project.name,
        url: generateConsoleUrl(CONSOLE_URLS.PROJECT, {
          projectId: project.id,
        }),
        type: "project",
      });
    }
  });

  const branches = await Promise.all(
    projects.map(async (project) => {
      return searchBranches(project.id, neonClient, query);
    }),
  );
  results.push(...branches.flat());
  return results;
};

const searchBranches = async (
  projectId: string,
  neonClient: Api<unknown>,
  query: string,
): Promise<SearchResult[]> => {
  try {
    const { data } = await neonClient.listProjectBranches({
      projectId,
    });
    const branches = data.branches;

    return branches
      .filter((branch) => matches(branch, query))
      .map((branch) => ({
        id: `branch:${projectId}/${branch.id}`,
        title: branch.name,
        url: generateConsoleUrl(CONSOLE_URLS.PROJECT_BRANCH, {
          projectId,
          branchId: branch.id,
        }),
        type: "branch",
      }));
  } catch {
    // Ignore if we fail to fetch branches
    return [];
  }
};
