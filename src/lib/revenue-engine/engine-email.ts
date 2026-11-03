/** One email to send, and the connection that sends it (see smtp-client.ts). */
export type OutgoingEmail = { to: string; subject: string; text: string; html?: string; headers: Record<string, string> };
export type EmailTransport = { send(message: OutgoingEmail): Promise<void>; close(): Promise<void> };

/** Permanent SMTP rejections that mean the address should never be tried again. */
export class PermanentEmailError extends Error {}
