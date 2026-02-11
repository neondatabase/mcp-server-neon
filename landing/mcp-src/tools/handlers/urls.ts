import { NEON_CONSOLE_HOST } from "../../constants";
import { NotFoundError } from "../../server/errors";

export enum CONSOLE_URLS {
  ORGANIZATION = "/app/:orgId/projects",
  PROJECT = "/app/projects/:projectId",
  PROJECT_BRANCH = "/app/projects/:projectId/branches/:branchId",
}

type ExtractPathParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [k in Param | keyof ExtractPathParams<`/${Rest}`>]: string | number }
    : T extends `${string}:${infer Param}`
      ? Record<Param, string | number>
      : Record<string, never>;

export function generateConsoleUrl<T extends CONSOLE_URLS>(
  url: T,
  params: ExtractPathParams<T>,
): string {
  const link = url.replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
    if ((params as any)[key] === undefined) {
      throw new NotFoundError(`Missing parameter '${key}' for url '${url}'`);
    }
    return encodeURIComponent(String((params as any)[key]));
  });
  return new URL(link, NEON_CONSOLE_HOST).toString();
}
