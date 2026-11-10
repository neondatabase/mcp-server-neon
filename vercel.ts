import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  fluid: true,
  // cle1 is AWS us-east-2, the region of the OAUTH_DATABASE_URL Neon project,
  // which the token store queries on every authenticated request.
  regions: ['cle1'],
  functions: {
    'app/api/**/*.ts': {
      maxDuration: 800,
    },
  },
  ignoreCommand:
    '[ "$VERCEL_GIT_COMMIT_REF" = "main" ] || [ "$VERCEL_GIT_COMMIT_REF" = "preview" ] && exit 1 || exit 0',
};
