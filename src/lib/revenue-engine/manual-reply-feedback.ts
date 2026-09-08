/** Browser-safe interpretation of the server receipt. HTTP success is not
 * delivery success. Never clear a draft or invite resend on an ambiguous result. */
export function manualReplyFeedback(status: number, body: unknown): {
  sent: boolean; preventResend: boolean; message: string;
} {
  const value = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const hasIntent = typeof value.intentId === "string" && /^[a-f0-9]{64}(?![\s\S])/.test(value.intentId);
  if (status === 503 && value.success === false && value.code === "MAIL_RUNTIME_UNAVAILABLE") {
    return { sent: false, preventResend: false,
      message: "Email sending is unavailable while the non-Google mail service and safety checks are being completed. Your draft has not been cleared." };
  }
  if (status === 200 && value.success === true && value.state === "SENT" && hasIntent) {
    return { sent: true, preventResend: true, message: "The mail service accepted this reply." };
  }
  if (status === 200 && value.success === true && value.state === "SENT_HISTORY_PENDING" && hasIntent) {
    return { sent: false, preventResend: true,
      message: "The mail service accepted this reply, but its activity history still needs repair. Do not send it again." };
  }
  if (value.state === "DELIVERY_UNCERTAIN" || value.state === "STATUS_UNAVAILABLE"
    || status >= 500 || (status >= 200 && status < 300)) {
    return { sent: false, preventResend: true,
      message: "Delivery could not be confirmed. Keep this draft and its reply reference; do not send another copy." };
  }
  if (status === 409 && value.state === "REJECTED" && value.success === false && hasIntent) {
    return { sent: false, preventResend: true,
      message: "The mail service rejected this reply. Review the rejection before approving any new attempt." };
  }
  return { sent: false, preventResend: false,
    message: "Sending is unavailable or this reply has not been approved. Your draft has not been cleared." };
}
