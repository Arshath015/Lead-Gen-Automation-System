export function isQuickDevLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // A public deployment must never turn an unauthenticated request into an
  // admin session, even if NODE_ENV was set incorrectly.
  return env.NODE_ENV === "development" &&
    env.ENABLE_DEV_LOGIN === "true" &&
    Boolean(env.REPLIT_DEV_DOMAIN) &&
    !env.REPLIT_DEPLOYMENT &&
    /^\d+$/.test(env.DEV_LOGIN_WORKSPACE_ID ?? "");
}