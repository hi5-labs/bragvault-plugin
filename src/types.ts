/** A raw captured signal, appended to the local journal. Never uploaded. */
export interface JournalEvent {
  id: string;
  kind: 'git_commit' | 'manual_brag' | 'session_summary';
  occurredAt: string; // ISO datetime
  capturedAt: string; // ISO datetime
  sourceTool: string; // claude-code | cursor | codex | unknown
  repo?: RepoInfo;
  git?: GitCommitInfo;
  session?: SessionInfo;
  structured?: StructuredAccomplishment;
  significance: number;
}

export interface RepoInfo {
  /** Repo directory basename; never the full path unless the user opts in. */
  name: string;
  /** sha256 of the origin remote URL; identifies the repo without exposing it. */
  remoteHash?: string;
  branch?: string;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** Histogram of file extensions touched, e.g. { ".ts": 9, ".md": 1 } */
  fileTypes: Record<string, number>;
  isMerge: boolean;
  tags: string[];
}

export interface SessionInfo {
  durationMinutes?: number;
  promptCount?: number;
  filesTouchedCount?: number;
  toolUseCount?: number;
}

/**
 * The structured accomplishment shape the backend stores as-is.
 * Mirrors the payload fields the legacy server-side analysis produced.
 */
export interface StructuredAccomplishment {
  title: string;
  summary: string;
  category?: string | null;
  impact?: string | null;
  context?: string | null;
  technologies?: string[];
}

/** A sync-queue entry: a redacted accomplishment candidate awaiting upload. */
export interface QueuedEvent {
  clientEventId: string;
  kind: JournalEvent['kind'];
  occurredAt: string;
  sourceTool: string;
  significance: number;
  structured: StructuredAccomplishment;
  repo?: RepoInfo;
  git?: Omit<GitCommitInfo, 'message'> & { message?: string };
  session?: SessionInfo;
  /** journal ids merged into this candidate */
  evidence: string[];
}
