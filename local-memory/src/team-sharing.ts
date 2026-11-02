/**
 * Team sharing stays off until the shared-folder writer is proven not to copy
 * lessons learned while sharing was off, and not to overwrite another install.
 * The commit that proves those tests flips this to true.
 */
export const TEAM_SHARING_AVAILABLE = false
