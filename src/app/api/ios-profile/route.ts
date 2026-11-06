import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Stable identifiers so re-installing REPLACES the existing Web Clip instead of
// stacking duplicate home-screen icons. Do not regenerate these per-request.
const PROFILE_UUID = "5f2a9c1e-7b34-4e8a-9c2d-0a1b2c3d4e5f";
const PAYLOAD_UUID = "a1b2c3d4-e5f6-47a8-b9c0-1d2e3f4a5b6c";
const PROFILE_IDENTIFIER = "ca.getaxiom.operations";
const WEBCLIP_IDENTIFIER = "ca.getaxiom.operations.webclip";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Serves an iOS Configuration Profile (.mobileconfig) that installs the
 * Axiom Revenue Engine as a full-screen Home Screen Web Clip — custom icon,
 * no Safari address bar. The clip URL is always the canonical APP_BASE_URL, so
 * it can never point at a stale/404 path (the failure mode of hand-rolled
 * profiles from third-party generators).
 */
export async function GET() {
  const env = getServerEnv();
  const base = env.APP_BASE_URL.replace(/\/+$/, "") + "/";

  // Pull the live app icon so the profile always matches the current logo.
  let iconData = "";
  try {
    const iconRes = await fetch(new URL("apple-touch-icon.png", base).toString());
    if (iconRes.ok) {
      iconData = bytesToBase64(new Uint8Array(await iconRes.arrayBuffer()));
    }
  } catch {
    // Icon is optional — iOS falls back to a screenshot if omitted.
    iconData = "";
  }

  const iconEntry = iconData
    ? `      <key>Icon</key>\n      <data>${iconData}</data>\n`
    : "";

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
${iconEntry}      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>Axiom Revenue</string>
      <key>PayloadDescription</key>
      <string>Adds the Axiom Revenue Engine to your Home Screen.</string>
      <key>PayloadDisplayName</key>
      <string>Axiom Revenue Web Clip</string>
      <key>PayloadIdentifier</key>
      <string>${WEBCLIP_IDENTIFIER}</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${PAYLOAD_UUID}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${xmlEscape(base)}</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Installs the Axiom Revenue Engine as a full-screen Home Screen app.</string>
  <key>PayloadDisplayName</key>
  <string>Axiom Revenue Engine</string>
  <key>PayloadIdentifier</key>
  <string>${PROFILE_IDENTIFIER}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${PROFILE_UUID}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;

  return new Response(plist, {
    status: 200,
    headers: {
      "Content-Type": "application/x-apple-aspen-config; charset=utf-8",
      "Content-Disposition": 'attachment; filename="axiom-ops.mobileconfig"',
      "Cache-Control": "no-store",
    },
  });
}
