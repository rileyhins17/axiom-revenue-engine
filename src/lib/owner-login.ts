/**
 * Private owner sign-in: pick Riley or Aidan, get a 6-digit code at that person's
 * personal inbox. The code signs in the existing workspace account; nothing else
 * can receive a code (the Worker's email binding only allows these two inboxes).
 */
export const OWNER_LOGINS = {
  riley: { name: "Riley", account: "riley@getaxiom.ca", inbox: "rileyhinsperger@gmail.com" },
  aidan: { name: "Aidan", account: "aidan@getaxiom.ca", inbox: "aidanmageebusiness@gmail.com" },
} as const;
export type OwnerKey = keyof typeof OWNER_LOGINS;
export const LOGIN_CODE_TTL_SECONDS = 600;

export function ownerForAccount(email: string) {
  const normalized = email.trim().toLowerCase();
  return Object.values(OWNER_LOGINS).find((owner) => owner.account === normalized) ?? null;
}

/** r••••••••••••@gmail.com */
export function maskInbox(inbox: string) {
  const [local = "", domain = ""] = inbox.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function loginEmail(name: string, code: string) {
  const spaced = code.split("").join(" ");
  const text = `Hi ${name},\n\nYour Axiom sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email; nobody can get in without the code.\n\nAxiom Revenue Engine`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f5ef;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0a0a0a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#fffdf8;border:1px solid #e6e1d6;border-radius:16px;overflow:hidden">
<tr><td style="background:#0a0a0a;padding:22px 28px;color:#f2f0ea;font-size:13px;letter-spacing:.24em;font-weight:700">AXIOM</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px;font-size:15px">Hi ${name},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3b3a36">Here's your sign-in code:</p>
<p style="margin:0 0 20px;font-family:Georgia,serif;font-size:38px;letter-spacing:.28em;color:#0a0a0a;font-weight:600">${spaced}</p>
<p style="margin:0;font-size:13px;color:#5c584f">It expires in 10 minutes. If you didn't try to sign in, ignore this email. Nobody can get in without the code.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: `${code} is your Axiom sign-in code`, text, html };
}

type LoginMail = { to: string; subject: string; text: string; html: string };
/** Set by worker.mjs from the Cloudflare send_email binding; absent in local builds. */
export async function deliverLoginEmail(mail: LoginMail) {
  const send = (globalThis as { __axiomSendLoginEmail?: (mail: LoginMail) => Promise<void> }).__axiomSendLoginEmail;
  if (!send) throw new Error("LOGIN_EMAIL_NOT_CONFIGURED");
  await send(mail);
}
