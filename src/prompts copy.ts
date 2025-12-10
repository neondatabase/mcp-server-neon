import { z } from 'zod';

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
    name: 'setup-neon-auth-vite-react',
    description:
      'Interactive guide for setting up Neon Auth in a Vite+React project. Walks through provisioning, package installation, client setup, and UI components.',
    argsSchema: setupNeonAuthViteReactArgsSchema,
  },
] as const;

export const getPromptTemplate = (
  promptName: string,
  args?: Record<string, string>,
): string => {
  if (promptName === 'setup-neon-auth-vite-react') {
    const projectId = args?.projectId;
    const branchId = args?.branchId;
    const databaseName = args?.databaseName;

    return `# Neon Auth Setup Guide (Interactive)

You are helping the user set up Neon Auth interactively in their Vite+React project. Follow this guide step-by-step.

## Style
- Report actions: "✓ Provisioned Neon Auth"
- Ask concisely: "Which project?"
- Follow steps sequentially, ask before proceeding when instructed
- User can pause/resume anytime

---

## Step 1: Provision Neon Auth

${projectId ? `**Project ID provided:** ${projectId}` : "**No project ID provided.** First, check the user's projects using `list_projects`."}
${branchId ? `**Branch ID provided:** ${branchId}` : ''}
${databaseName ? `**Database name provided:** ${databaseName}` : ''}

${
  !projectId
    ? `
**If they have NO projects:**
- Ask if they want to create one
- Guide them to create at console.neon.tech or via \`create_project\`

**If they have 1 project:**
- Ask: "Want to add Neon Auth to '{project_name}'?"

**If they have multiple projects:**
- List project names and ask which one to use
`
    : ''
}

**Once project is confirmed, provision Neon Auth:**

Use the \`provision_neon_auth\` tool with:
- \`projectId\`: The selected project ID
- \`branchId\`: (optional) defaults to main branch
- \`databaseName\`: (optional) defaults to neondb

**After provisioning, save the \`base_url\` from the response.** You'll need it for Step 3.

---

## Step 2: Choose Your Package

Ask: "Will your app query the database directly (beyond auth)?"

**If YES (auth + database queries):**
- Package: \`@neondatabase/neon-js\`
- Includes: Auth client, Data API client, UI components
- Use case: Full-stack apps that query user data

**If NO (auth only):**
- Package: \`@neondatabase/auth\`
- Includes: Auth client, UI components
- Use case: Apps using separate backend, or auth-only features
- Benefit: Smaller bundle size

---

## Step 3: Install Dependencies

**Check if packages are already installed** by looking at package.json.

**For auth-only (\`@neondatabase/auth\`):**
\`\`\`bash
npm install @neondatabase/auth
\`\`\`

**For auth + database (\`@neondatabase/neon-js\`):**
\`\`\`bash
npm install @neondatabase/neon-js
\`\`\`

---

## Step 4: Configure Environment Variables

Create or update \`.env\` file in project root:

\`\`\`bash
# Required - from provisioning response (Step 1)
VITE_NEON_AUTH_URL=<base_url_from_step_1>

# Only if using @neondatabase/neon-js with database queries
VITE_NEON_DATA_API_URL=<data_api_url>
\`\`\`

**IMPORTANT:** Add \`.env\` to \`.gitignore\` if not already present.

---

## Step 5: Create Auth Client

**Check for existing auth setup** in the codebase first.

Create \`src/lib/auth-client.ts\` (or similar based on project structure):

**For auth-only (\`@neondatabase/auth\`):**
\`\`\`ts
import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthReactAdapter } from '@neondatabase/auth/react/adapters';

export const authClient = createAuthClient(
  import.meta.env.VITE_NEON_AUTH_URL,
  { adapter: BetterAuthReactAdapter() }
);
\`\`\`

**For auth + database (\`@neondatabase/neon-js\`):**
\`\`\`ts
import { createClient } from '@neondatabase/neon-js';
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters';

export const client = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: import.meta.env.VITE_NEON_AUTH_URL,
  },
  dataApi: {
    url: import.meta.env.VITE_NEON_DATA_API_URL,
  },
});

// For convenience, export auth separately
export const authClient = client.auth;
\`\`\`

**IMPORTANT:**
- \`BetterAuthReactAdapter\` must be imported from the \`/react/adapters\` subpath
- The adapter must be called as a function: \`BetterAuthReactAdapter()\`

---

## Step 6: Add Auth UI (Optional)

Ask: "Want to add pre-built auth UI components? (sign-in, sign-up forms, user button, account settings)"

**If yes, continue with sub-steps below.**

### 6a. Install react-router-dom

\`\`\`bash
npm install react-router-dom
\`\`\`

UI components are included in the main package, you only need react-router-dom for navigation.

### 6b. Import the CSS

**CRITICAL:** Choose ONE import method. Never import both - it causes duplicate styles.

**Check if the project uses Tailwind CSS** by looking for:
- \`tailwind.config.js\` or \`tailwind.config.ts\` in the project root
- \`@import 'tailwindcss'\` or \`@tailwind\` directives in CSS files
- \`tailwindcss\` in package.json dependencies

**If NOT using Tailwind** - Add to \`src/main.tsx\` or entry point:

For \`@neondatabase/auth\`:
\`\`\`ts
import '@neondatabase/auth/ui/css';
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`ts
import '@neondatabase/neon-js/ui/css';
\`\`\`

**If using Tailwind CSS v4** - Add to main CSS file (e.g., index.css):

For \`@neondatabase/auth\`:
\`\`\`css
@import 'tailwindcss';
@import '@neondatabase/auth/ui/tailwind';
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`css
@import 'tailwindcss';
@import '@neondatabase/neon-js/ui/tailwind';
\`\`\`

### 6c. Styling with CSS Variables

**IMPORTANT:** The UI package already includes all necessary CSS variables. Do NOT copy these into your own CSS file.

When adding custom styles around auth components, **only reference these pre-defined CSS variables**:
- \`var(--background)\`, \`var(--foreground)\` - Page background/text
- \`var(--card)\`, \`var(--card-foreground)\` - Card surfaces
- \`var(--primary)\`, \`var(--primary-foreground)\` - Primary buttons/actions
- \`var(--secondary)\`, \`var(--secondary-foreground)\` - Secondary elements
- \`var(--muted)\`, \`var(--muted-foreground)\` - Muted/subtle elements
- \`var(--destructive)\` - Destructive/danger actions
- \`var(--border)\`, \`var(--input)\`, \`var(--ring)\` - Borders and focus rings
- \`var(--radius)\` - Border radius

**Dark mode:** Add the \`dark\` class to \`<html>\` or \`<body>\` to enable it.

### 6d. Update main.tsx with BrowserRouter

For \`@neondatabase/auth\`:
\`\`\`tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@neondatabase/auth/ui/css'; // if not using Tailwind
import App from './App';
import { Providers } from './providers';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Providers>
      <App />
    </Providers>
  </BrowserRouter>
);
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@neondatabase/neon-js/ui/css'; // if not using Tailwind
import App from './App';
import { Providers } from './providers';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Providers>
      <App />
    </Providers>
  </BrowserRouter>
);
\`\`\`

### 6e. Create the Auth Provider

Create \`src/providers.tsx\`:

For \`@neondatabase/auth\`:
\`\`\`tsx
import { NeonAuthUIProvider } from '@neondatabase/auth/react/ui';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { authClient } from './lib/auth-client';
import type { ReactNode } from 'react';

// Adapter for react-router-dom Link
function Link({ href, ...props }: { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <RouterLink to={href} {...props} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={(path) => navigate(path)}
      replace={(path) => navigate(path, { replace: true })}
      onSessionChange={() => {
        // Optional: refresh data or invalidate cache
      }}
      Link={Link}
      social={{
        providers: ['google', 'github']
      }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`tsx
import { NeonAuthUIProvider } from '@neondatabase/neon-js/auth/react/ui';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { authClient } from './lib/auth-client';
import type { ReactNode } from 'react';

// Adapter for react-router-dom Link
function Link({ href, ...props }: { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <RouterLink to={href} {...props} />;
}

export function Providers({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={(path) => navigate(path)}
      replace={(path) => navigate(path, { replace: true })}
      onSessionChange={() => {
        // Optional: refresh data or invalidate cache
      }}
      Link={Link}
      social={{
        providers: ['google', 'github']
      }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}
\`\`\`

**Provider props explained:**
- \`navigate\`: Function to navigate to a new route
- \`replace\`: Function to replace current route (for redirects)
- \`onSessionChange\`: Callback when auth state changes (useful for cache invalidation)
- \`social\`: Show Google and GitHub sign-in buttons (both enabled by default in Neon)

### 6f. Add routes to App.tsx

For \`@neondatabase/auth\`:
\`\`\`tsx
import { Routes, Route, useParams } from 'react-router-dom';
import { AuthView, UserButton, SignedIn, SignedOut } from '@neondatabase/auth/react/ui';

// Auth page - handles /auth/sign-in, /auth/sign-up, etc.
function AuthPage() {
  const { pathname } = useParams();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <AuthView pathname={pathname} />
    </div>
  );
}

// Simple navbar example
function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 border-b">
      <a href="/">My App</a>
      <div className="flex items-center gap-4">
        <SignedOut>
          <a href="/auth/sign-in">Sign In</a>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </nav>
  );
}

function HomePage() {
  return <div>Welcome to My App!</div>;
}

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/:pathname" element={<AuthPage />} />
      </Routes>
    </>
  );
}
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`tsx
import { Routes, Route, useParams } from 'react-router-dom';
import { AuthView, UserButton, SignedIn, SignedOut } from '@neondatabase/neon-js/auth/react/ui';

// Auth page - handles /auth/sign-in, /auth/sign-up, etc.
function AuthPage() {
  const { pathname } = useParams();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <AuthView pathname={pathname} />
    </div>
  );
}

// Simple navbar example
function Navbar() {
  return (
    <nav className="flex items-center justify-between p-4 border-b">
      <a href="/">My App</a>
      <div className="flex items-center gap-4">
        <SignedOut>
          <a href="/auth/sign-in">Sign In</a>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </nav>
  );
}

function HomePage() {
  return <div>Welcome to My App!</div>;
}

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/:pathname" element={<AuthPage />} />
      </Routes>
    </>
  );
}
\`\`\`

**Auth routes created:**
- \`/auth/sign-in\` - Sign in page
- \`/auth/sign-up\` - Sign up page
- \`/auth/forgot-password\` - Password reset request
- \`/auth/reset-password\` - Set new password
- \`/auth/sign-out\` - Sign out
- \`/auth/callback\` - OAuth callback (internal)

---

## Step 7: Add Account Settings Pages (Optional)

Ask: "Want to add account settings pages where users can manage their profile?"

**If yes:**

### 7a. Add account routes to App.tsx

For \`@neondatabase/auth\`:
\`\`\`tsx
import { AccountView } from '@neondatabase/auth/react/ui';

// Account settings page
function AccountPage() {
  const { pathname } = useParams();
  return (
    <div className="container mx-auto py-8">
      <AccountView pathname={pathname} />
    </div>
  );
}

// Add to your Routes
<Route path="/account/:pathname" element={<AccountPage />} />
\`\`\`

For \`@neondatabase/neon-js\`:
\`\`\`tsx
import { AccountView } from '@neondatabase/neon-js/auth/react/ui';

// Account settings page
function AccountPage() {
  const { pathname } = useParams();
  return (
    <div className="container mx-auto py-8">
      <AccountView pathname={pathname} />
    </div>
  );
}

// Add to your Routes
<Route path="/account/:pathname" element={<AccountPage />} />
\`\`\`

**Account routes created:**
- \`/account/settings\` - Profile settings (name, avatar, email)
- \`/account/security\` - Password, sessions, 2FA
- \`/account/sessions\` - Active sessions management

---

## Available Components Reference

### Import Paths

For \`@neondatabase/auth\`:
- Auth client: \`@neondatabase/auth\`
- React adapter: \`@neondatabase/auth/react/adapters\`
- UI components: \`@neondatabase/auth/react/ui\`
- CSS: \`@neondatabase/auth/ui/css\`
- Tailwind: \`@neondatabase/auth/ui/tailwind\`

For \`@neondatabase/neon-js\`:
- Main client: \`@neondatabase/neon-js\`
- React adapter: \`@neondatabase/neon-js/auth/react/adapters\`
- UI components: \`@neondatabase/neon-js/auth/react/ui\`
- CSS: \`@neondatabase/neon-js/ui/css\`
- Tailwind: \`@neondatabase/neon-js/ui/tailwind\`

### Core Components (inside NeonAuthUIProvider)

**Authentication Views:**
\`\`\`tsx
// Full auth view (handles routing)
<AuthView pathname="sign-in" />

// Individual forms (embed anywhere)
<SignInForm />
<SignUpForm />
\`\`\`

**User Button & Avatar:**
\`\`\`tsx
// Dropdown with user menu, settings link, sign out
<UserButton />

// Just the avatar
<UserAvatar />
\`\`\`

**Conditional Rendering:**
\`\`\`tsx
// Show only when signed in
<SignedIn>
  <p>Welcome back!</p>
  <UserButton />
</SignedIn>

// Show only when signed out
<SignedOut>
  <a href="/auth/sign-in">Sign In</a>
</SignedOut>

// Show while auth is loading
<AuthLoading>
  <p>Loading...</p>
</AuthLoading>
\`\`\`

**Redirects:**
\`\`\`tsx
// Redirect unauthenticated users
function ProtectedPage() {
  return (
    <>
      <RedirectToSignIn />
      <SignedIn>
        <p>Protected content</p>
      </SignedIn>
    </>
  );
}
\`\`\`

**Account/Settings Views:**
\`\`\`tsx
// Full account view with navigation
<AccountView pathname="settings" />

// Or use SettingsCards directly
<SettingsCards />
\`\`\`

**Individual Settings Cards:**
\`\`\`tsx
// Build custom settings pages
<div className="space-y-4">
  <UpdateAvatarCard />
  <UpdateNameCard />
  <ChangeEmailCard />
  <ChangePasswordCard />
  <SessionsCard />
  <DeleteAccountCard />
</div>
\`\`\`

---

## Provider Configuration Options

The NeonAuthUIProvider accepts many configuration options:

\`\`\`tsx
<NeonAuthUIProvider
  authClient={authClient}
  navigate={navigate}
  replace={replace}
  onSessionChange={() => {}}
  Link={Link}

  // Avatar upload (optional)
  avatar={{
    upload: async (file) => {
      // Upload to your storage, return URL
      const url = await uploadFile(file);
      return url;
    },
  }}

  // Google and Github are pre-configured in Neon by default
  social={{
    providers: ['google', 'github'],
  }}

  // Custom localization (optional)
  localization={{
    signIn: 'Log In',
    signUp: 'Create Account',
  }}
>
  {children}
</NeonAuthUIProvider>
\`\`\`

---

## Step 8: What's Next

Once setup is complete:

"Neon Auth is ready! Here's what you can do:
- Visit /auth/sign-up to create an account
- Visit /auth/sign-in to log in
- The UserButton shows a dropdown when signed in
- Visit /account/settings to manage your profile
- Google and GitHub OAuth are enabled by default"

---

## Common Mistakes to Avoid

1. **Wrong adapter import**: \`BetterAuthReactAdapter\` must come from \`/react/adapters\` subpath
2. **Not calling adapter as function**: Use \`BetterAuthReactAdapter()\` not \`BetterAuthReactAdapter\`
3. **Importing both CSS files**: Choose ui/css OR ui/tailwind, never both
4. **Missing "use client" directive**: In Next.js, auth components need \`"use client"\`
5. **Wrong createAuthClient signature**: First arg is URL string, second is config object
6. **Missing environment variables**: Ensure VITE_NEON_AUTH_URL is set in .env

---

## Important Notes

- Check existing code/config before making changes
- Provide working code examples
- Don't overwrite existing files without checking first
- If something fails, always give a manual fallback`;
  }

  throw new Error(`Unknown prompt: ${promptName}`);
};
