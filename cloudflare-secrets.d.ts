/**
 * Secret binding names are declared separately from Wrangler-generated resource
 * bindings. Never place values in this file. Production values belong in the
 * Cloudflare secret store; local values belong in ignored environment files.
 */
interface CloudflareEnv {
  BETTER_AUTH_SECRET?: string;
  FCC_CAMPAIGN_MAILING_ADDRESS?: string;
  FCC_SMTP_PASSWORD?: string;
  FCC_SMTP_PASSWORD_2?: string;
}

declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET?: string;
    FCC_CAMPAIGN_MAILING_ADDRESS?: string;
    FCC_SMTP_PASSWORD?: string;
    FCC_SMTP_PASSWORD_2?: string;
  }
}
