// Explicit Research host contract. Keep exports scoped; never export *.
export {
  ProjectAccessDeniedError,
  assertProjectRootAccess,
  createAccessGroup,
  effectiveProjectAccess,
  grantProjectToFamiliar,
  listProjectGrants,
  loadProjectPermissions,
  revokeAllGrantsForProject,
} from "@/lib/project-permissions";
