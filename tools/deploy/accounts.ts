// Which third-party accounts production depends on are ready
// (tasks/plans/analytics.md D9). Versioned on purpose: the commit that flips a
// flag is the reviewable act that turns a missing variable into a blocked
// deploy (tools/deploy/check-prod.ts).

/**
 * The Umami website exists and VITE_UMAMI_WEBSITE_ID is set for production
 * builds (the repo variable in CI, `.env.production.local` for a local deploy).
 *
 * `true` since 2026-10-19: the Umami account was opened and the repo
 * variable exists (plan §9.5). A production build without the ID now blocks
 * the deploy; setting it back to `false` is the reviewable act that accepts
 * production without analytics again (plan §9.1).
 */
export const UMAMI_READY: boolean = true;
