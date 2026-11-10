/** Data contracts for the currently supported CR proposal workflow. */
export type FieldName = "tdoc" | "cr" | "revision" | "version";
export type MetadataField = "spec" | "release" | "source";
export type NamingMode = "number" | "preserve";
export type FileBytes = Uint8Array<ArrayBuffer>;

export interface ProposalMetadata {
  title: string;
  source: string;
  release: string;
  spec: string;
}

export interface MeetingRecord extends ProposalMetadata {
  id: string;
  tdoc: string;
  cr: string;
  revision: string;
  version: string;
}

export interface SourcedRecord extends MeetingRecord {
  row: string;
  sourceFile: string;
}

export interface MeetingFile {
  id: string;
  name: string;
  size: number;
  records?: MeetingRecord[];
  error?: string;
}

export interface CRProposal {
  kind: "cr";
  file: File;
  bytes: FileBytes;
  metadata: ProposalMetadata;
  values: Record<FieldName, string>;
}

export interface MatchResult {
  candidates: SourcedRecord[];
  selectedId: string;
  reason: "" | "no_match" | "ambiguous" | "metadata_conflict";
}

export interface ProposalItem extends MatchResult {
  id: string;
  file: File;
  confirmed: boolean;
  excluded: boolean;
  proposal?: CRProposal;
  error?: string;
  exportError?: string;
}

export interface FieldChange {
  field: FieldName;
  before: string;
  after: string;
  changed: boolean;
  conflict: boolean;
}

export interface ProposalPlan {
  record: SourcedRecord;
  changes: FieldChange[];
  metadataConflicts: MetadataField[];
  conflicts: number;
  ready: boolean;
  outputName: string;
  error?: never;
}

export interface PlanFailure {
  error: string;
  ready?: never;
  outputName?: never;
  changes?: never;
  record?: never;
}

export interface ExportFile {
  name: string;
  bytes: FileBytes;
}
