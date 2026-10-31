import * as Schema from "effect/Schema";
import { CommandId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const FogBugzId = Schema.Int.check(Schema.isGreaterThan(0));
export const FogBugzProjectGroup = Schema.Struct({ id: FogBugzId, name: Schema.String });
export const FogBugzProject = Schema.Struct({
  id: FogBugzId,
  name: Schema.String,
  groups: Schema.Array(FogBugzProjectGroup),
});
export const FogBugzConnection = Schema.Struct({
  id: Schema.String,
  baseUrl: Schema.String,
  username: Schema.String,
  personId: FogBugzId,
  personName: Schema.String,
  authenticated: Schema.Boolean,
});
export type FogBugzConnection = typeof FogBugzConnection.Type;
export const FogBugzProjectLink = Schema.Struct({
  projectId: ProjectId,
  fogbugzProjectId: Schema.NullOr(FogBugzId),
  fogbugzProjectGroupId: Schema.NullOr(FogBugzId),
});
export const FogBugzStatus = Schema.Struct({
  connection: Schema.NullOr(FogBugzConnection),
  projects: Schema.Array(FogBugzProjectLink),
});
export const FogBugzCase = Schema.Struct({
  id: FogBugzId,
  title: Schema.String,
  projectId: FogBugzId,
  projectName: Schema.String,
  status: Schema.String,
  open: Schema.Boolean,
  assignedTo: Schema.Int,
  assignedToName: Schema.String,
  priority: Schema.String,
  priorityId: Schema.optionalKey(FogBugzId),
  categoryId: Schema.Int,
  categoryName: Schema.String,
  categoryIconType: Schema.Int,
  notifiedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type FogBugzCase = typeof FogBugzCase.Type;
export const FogBugzCaseEvent = Schema.Struct({
  id: FogBugzId,
  author: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  text: Schema.String,
});
export const FogBugzCaseContext = Schema.Struct({
  case: FogBugzCase,
  url: Schema.String,
  events: Schema.Array(FogBugzCaseEvent),
});
export type FogBugzCaseContext = typeof FogBugzCaseContext.Type;
export const FogBugzCaseContextInput = Schema.Union([
  Schema.Struct({ threadId: ThreadId, caseId: FogBugzId }),
  Schema.Struct({ projectId: ProjectId, caseId: FogBugzId }),
]);
export const FogBugzThreadLink = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  caseId: FogBugzId,
  title: Schema.String,
  url: Schema.String,
});
export const FogBugzCaseGitCheckout = Schema.Struct({
  caseId: FogBugzId,
  repositoryId: Schema.String,
  cwd: Schema.String,
  canWrite: Schema.Boolean,
  syncIssue: Schema.optional(Schema.String),
});
export const FogBugzCaseFilesInput = Schema.Struct({
  threadId: ThreadId,
  action: Schema.Union([
    Schema.Struct({ type: Schema.Literal("create-file"), path: TrimmedNonEmptyString }),
    Schema.Struct({ type: Schema.Literal("create-directory"), path: TrimmedNonEmptyString }),
    Schema.Struct({ type: Schema.Literal("delete"), path: TrimmedNonEmptyString }),
    Schema.Struct({
      type: Schema.Literal("upload"),
      files: Schema.Array(
        Schema.Struct({
          path: TrimmedNonEmptyString,
          attachmentId: Schema.NullOr(TrimmedNonEmptyString),
        }),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    }),
  ]),
});
export const FogBugzThreadCase = Schema.Struct({
  threadId: ThreadId,
  case: FogBugzCase,
});
export const FogBugzCaseList = Schema.Struct({
  cases: Schema.Array(FogBugzCase),
  threads: Schema.Array(FogBugzThreadLink),
  truncated: Schema.Boolean,
  projects: Schema.Array(Schema.Struct({ projectId: ProjectId, fogbugzProjectId: FogBugzId })),
});
export const FogBugzConnectInput = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  username: TrimmedNonEmptyString,
  password: Schema.String.check(Schema.isMaxLength(4096)),
});
export const FogBugzCasesInput = Schema.Struct({
  query: Schema.String.check(Schema.isMaxLength(200)),
  state: Schema.Literals(["open", "closed", "all"]),
  assignedToMe: Schema.Boolean,
  projectId: Schema.optionalKey(ProjectId),
});
export const FogBugzLinkThreadInput = Schema.Struct({
  threadId: ThreadId,
  caseId: Schema.NullOr(FogBugzId),
});
export const FogBugzCreateThreadInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  caseId: FogBugzId,
  modelSelection: ModelSelection,
});

const messages = {
  case_files_path:
    "Use a relative case file path without reserved names, traversal, or symbolic links.",
  case_files_exists: "The destination already exists. Choose another name or delete it first.",
  case_files_readonly: "This FogBugz account cannot change case files.",
  case_files_busy: "Wait for the agent's turn to finish before changing case files.",
  case_files_limit: "The case file size, upload group, or repository limit would be exceeded.",
  case_files_io: "Could not change case files. Refresh the files and try again.",
  connection_required: "Configure FogBugz in Settings > MGGM first.",
  authentication: "FogBugz sign-in failed or expired. Sign in again in Settings > MGGM.",
  network: "Could not reach the FogBugz API.",
  response: "FogBugz returned an invalid API response.",
  access: "The FogBugz case or project is not accessible to this account.",
  url: "Use an HTTPS base URL without credentials, a query, or a fragment. HTTP is allowed for localhost and private IP addresses.",
  storage: "Could not save or load the FogBugz integration.",
  project: "Link this T3 project to the case's FogBugz project first.",
  thread: "Could not create or load the T3 thread.",
  case_git:
    "Could not prepare the case Git checkout. Check the case file storage, permissions, and Git connection.",
} as const;
export class FogBugzError extends Schema.TaggedError<FogBugzError>()("FogBugzError", {
  code: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
}) {
  override get message() {
    return messages[this.code];
  }
}
