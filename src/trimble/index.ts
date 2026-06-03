/*
Public surface of the Trimble Connect API client. Internal helpers in
`./internal` are intentionally not re-exported.
*/

export {
  WORKSPACE_EVENT_ACCESS_TOKEN,
  WORKSPACE_EVENT_EXTENSION_COMMAND,
  WORKSPACE_COMMAND_MAIN_CLICKED,
  normalizeWorkspaceEventArguments,
  connectWorkspaceApi,
  requestAccessTokenPermission,
  getCurrentProject,
  registerMainMenu,
  setExtensionStatusMessage,
  resetWorkspaceConnectCacheForTesting,
} from "./workspaceClient";
export type {
  WorkspaceApi,
  WorkspaceApiGlobal,
  WorkspaceProjectApi,
  WorkspaceExtensionApi,
  WorkspaceUiApi,
  WorkspaceMenuDefinition,
  WorkspaceEventHandler,
  NormalizedWorkspaceEvent,
} from "./workspaceClient";

export {
  CORE_API_BASE_URL_CANDIDATES,
  listProjectIfcFiles,
  listProjectFolderItems,
  downloadIfcArrayBuffer,
  downloadFileArrayBuffer,
  uploadFileArrayBuffer,
  findOrCreateProjectFolder,
  isIfcFileName,
} from "./coreApiClient";
export type {
  ListProjectIfcFilesResult,
  FolderListing,
  UploadFileInput,
  UploadFileResult,
  UploadTimeouts,
} from "./coreApiClient";

export {
  extractAccessTokenFromPayload,
  extractAccessTokenPermissionStatus,
  setCachedAccessToken,
  getCachedAccessToken,
  clearCachedAccessToken,
  updateAccessTokenCacheFromEvent,
} from "./accessToken";
export type { AccessTokenPermissionStatus } from "./accessToken";
