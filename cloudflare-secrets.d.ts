/**
 * Secret binding names are declared separately from Wrangler-generated resource
 * bindings. Never place values in this file. Production values belong in the
 * Cloudflare secret store; local values belong in ignored environment files.
 */
interface CloudflareEnv {
  AGENT_SHARED_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  DEEPSEEK_API_KEY?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  OPENAI_API_KEY?: string;
}

declare namespace Cloudflare {
  interface Env {
    AGENT_SHARED_SECRET?: string;
    BETTER_AUTH_SECRET?: string;
    DEEPSEEK_API_KEY?: string;
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    OPENAI_API_KEY?: string;
  }
}
