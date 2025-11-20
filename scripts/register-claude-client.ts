#!/usr/bin/env node
/**
 * Script to register a client for Claude.ai with the required redirect URI
 *
 * ⚠️ IMPORTANT: This only needs to be run ONCE per environment.
 * After registration, Claude/Anthropic stores the credentials and uses them
 * for all users. Individual users will complete OAuth flows using the same
 * client_id and client_secret, but each gets their own access token.
 *
 * Usage:
 *   npx tsx scripts/register-claude-client.ts [SERVER_URL]
 *
 * Example:
 *   npx tsx scripts/register-claude-client.ts https://mcp.neon.tech
 *   npx tsx scripts/register-claude-client.ts http://localhost:3001
 */

const SERVER_URL = process.argv[2] || 'http://localhost:3001';
// Claude supports both .ai and .com domains for future-proofing
const CLAUDE_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

interface ClientRegistrationResponse {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

async function registerClaudeClient(): Promise<void> {
  const registrationPayload = {
    client_name: 'Claude',
    client_uri: 'https://claude.ai',
    redirect_uris: CLAUDE_REDIRECT_URIS,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  };

  console.log(`\nRegistering Claude client with MCP Server at: ${SERVER_URL}`);
  console.log(`Redirect URIs:`);
  CLAUDE_REDIRECT_URIS.forEach((uri) => console.log(`  - ${uri}`));
  console.log();

  try {
    const response = await fetch(`${SERVER_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationPayload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Failed to register client:');
      console.error(JSON.stringify(errorData, null, 2));
      process.exit(1);
    }

    const data: ClientRegistrationResponse = await response.json();

    console.log('✅ Successfully registered Claude client!\n');
    console.log('📋 Client Details:');
    console.log('─'.repeat(60));
    console.log(`Client ID:              ${data.client_id}`);
    console.log(`Client Secret:          ${data.client_secret}`);
    console.log(`Client Name:            ${data.client_name}`);
    console.log(`Redirect URIs:          ${data.redirect_uris.join(', ')}`);
    console.log(`Auth Method:            ${data.token_endpoint_auth_method}`);
    console.log('─'.repeat(60));

    console.log('\n⚠️  IMPORTANT: Save these credentials securely!');
    console.log('   The client secret cannot be retrieved later.\n');

    console.log('📝 Next Steps:');
    console.log('   1. Provide these credentials to Claude/Anthropic');
    console.log(
      '   2. They will use the client_id and client_secret for OAuth',
    );
    console.log('   3. The redirect URI is now whitelisted for this client\n');
  } catch (error) {
    console.error('❌ Error during registration:');
    console.error(error);
    process.exit(1);
  }
}

// Run the registration
registerClaudeClient();
