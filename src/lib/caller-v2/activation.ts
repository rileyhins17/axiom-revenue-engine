/** Deployment opt-in is scoped to exactly one source workspace; tokens cannot enable it. */
export function callerEnabled(env: unknown, workspaceId: string): boolean {
  if (!env || typeof env !== 'object') return false;
  const config=env as Record<string,unknown>;
  return config.CALLER_V2_ENABLED==='true' && config.CALLER_V2_WORKSPACE_ID===workspaceId;
}
