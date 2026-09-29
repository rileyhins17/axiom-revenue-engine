import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP } from "better-auth/plugins";

import { writeAuditEvent } from "@/lib/audit";
import { assertOperatorSignupAllowed } from "@/lib/auth-signup-policy";
import { getClientIp, getCloudflareBindings } from "@/lib/cloudflare";
import { getAllowedEmails, getServerEnv, getTrustedOrigins, isAdminEmail } from "@/lib/env";
import { ensureLocalDatabaseDirectory, getLocalDatabasePath } from "@/lib/local-sqlite";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/rate-limit";
import { deliverLoginEmail, LOGIN_CODE_TTL_SECONDS, loginEmail, ownerForAccount } from "@/lib/owner-login";

function isAllowedEmail(email: string) {
  const allowed = getAllowedEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}

const globalForAuth = globalThis as typeof globalThis & {
  // better-auth's plugin-augmented return type is not stable through ReturnType<typeof betterAuth>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axiomAuth?: any;
};

export function getAuth() {
  if (globalForAuth.axiomAuth) {
    return globalForAuth.axiomAuth;
  }

  const env = getServerEnv();
  const bindings = getCloudflareBindings();

  // Determine database config — use CF D1 when available, local SQLite otherwise
  let databaseConfig: { database: unknown };
  if (bindings?.DB) {
    databaseConfig = { database: bindings.DB };
  } else {
    // For local/Pi deployment, use the local SQLite database via better-sqlite3
    // better-auth accepts a better-sqlite3 Database instance directly
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3");
    const dbPath = getLocalDatabasePath();
    ensureLocalDatabaseDirectory(dbPath);
    const localDb = new BetterSqlite3(dbPath);
    localDb.pragma("journal_mode = WAL");
    databaseConfig = { database: localDb };
  }

  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    ...databaseConfig,
    trustedOrigins: getTrustedOrigins(),
    emailAndPassword: {
      // Live sign-in is by emailed code only. Passwords stay available for local test fixtures.
      enabled: String(bindings?.AUTH_PASSWORD_SIGNIN ?? process.env.AUTH_PASSWORD_SIGNIN ?? "false") === "true",
      autoSignIn: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 6,
      cookieCache: {
        enabled: true,
        maxAge: 300,
        refreshCache: false,
        strategy: "compact",
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const ipAddress = ctx.request ? getClientIp(ctx.request) : "unknown";

        if (ctx.path === "/email-otp/send-verification-otp" || ctx.path === "/sign-in/email-otp") {
          await assertRateLimit({
            identifier: `${ipAddress}:${ctx.path}`,
            limit: Math.min(10, env.RATE_LIMIT_MAX_AUTH),
            scope: "auth",
            windowSeconds: 15 * 60,
          });
          const email = String(ctx.body?.email || "");
          if (!ownerForAccount(email) || (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "sign-in")) {
            throw new APIError("FORBIDDEN", { message: "Pick Riley or Aidan." });
          }
        }

        if (ctx.path === "/sign-in/email" || ctx.path === "/sign-up/email") {
          await assertRateLimit({
            identifier: `${ipAddress}:${ctx.path}`,
            limit: env.RATE_LIMIT_MAX_AUTH,
            scope: "auth",
            windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
          });
        }

        if (ctx.path === "/sign-up/email") {
          try {
            assertOperatorSignupAllowed({
              appBaseUrl: env.APP_BASE_URL,
              cloudflareDatabaseBound: Boolean(bindings?.DB),
              localSyntheticSignupFlag: process.env.AXIOM_LOCAL_SYNTHETIC_SIGNUP,
            });
          } catch {
            throw new APIError("FORBIDDEN", {
              message: "Operator accounts are provisioned privately. Sign in with an existing account.",
            });
          }

          const email = String(ctx.body?.email || "").trim().toLowerCase();
          if (!email || !isAllowedEmail(email)) {
            throw new APIError("FORBIDDEN", {
              message: "This email address is not authorized for Axiom ops access.",
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ipAddress = ctx.request ? getClientIp(ctx.request) : "unknown";
        const session = ctx.context.newSession;

        if ((ctx.path === "/sign-in/email" || ctx.path === "/sign-in/email-otp") && session) {
          await writeAuditEvent({
            action: "auth.sign_in",
            actorUserId: session.user.id,
            ipAddress,
            metadata: { email: session.user.email, method: ctx.path === "/sign-in/email-otp" ? "EMAIL_CODE" : "PASSWORD" },
          });
        }

        if (ctx.path === "/sign-up/email" && session) {
          const promotedToAdmin = isAdminEmail(session.user.email);

          if (promotedToAdmin) {
            await getPrisma().user.update({
              where: { id: session.user.id },
              data: { role: "admin" },
            });
          }

          await writeAuditEvent({
            action: "auth.sign_up",
            actorUserId: session.user.id,
            ipAddress,
            metadata: {
              email: session.user.email,
              promotedToAdmin,
            },
          });
        }

        if (ctx.path === "/sign-out") {
          await writeAuditEvent({
            action: "auth.sign_out",
            actorUserId: session?.user.id ?? null,
            ipAddress,
          });
        }
      }),
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
      emailOTP({
        disableSignUp: true,
        otpLength: 6,
        expiresIn: LOGIN_CODE_TTL_SECONDS,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp, type }) {
          const owner = ownerForAccount(email);
          if (type !== "sign-in" || !owner) return;
          await deliverLoginEmail({ to: owner.inbox, ...loginEmail(owner.name, otp) });
        },
      }),
      nextCookies(),
    ],
  });

  globalForAuth.axiomAuth = auth;
  return auth;
}
