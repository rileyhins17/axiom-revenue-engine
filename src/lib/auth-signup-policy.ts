type OperatorSignupContext = {
  appBaseUrl: string;
  cloudflareDatabaseBound: boolean;
  localSyntheticSignupFlag: string | undefined;
};

export function assertOperatorSignupAllowed(context: OperatorSignupContext) {
  let appUrl: URL;
  try {
    appUrl = new URL(context.appBaseUrl);
  } catch {
    throw new Error("Operator account signup is disabled.");
  }

  const loopback = appUrl.hostname === "localhost" ||
    appUrl.hostname === "127.0.0.1" ||
    appUrl.hostname === "[::1]";
  const localFixture = !context.cloudflareDatabaseBound &&
    appUrl.protocol === "http:" &&
    loopback &&
    context.localSyntheticSignupFlag === "1";

  if (!localFixture) {
    throw new Error("Operator account signup is disabled.");
  }
}
