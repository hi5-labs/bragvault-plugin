/**
 * The wire contract with the BragVault backend (`/api/plugin`). This file is
 * the source of truth shared with the backend team; see docs/api-contract.md.
 *
 * The backend is a lean receiver: it registers events as already-processed
 * accomplishments and runs no AI analysis on them.
 */

export interface MeResponse {
  ok: boolean;
  user_id: number;
  email: string;
  token_name: string;
  scopes: string[];
  plugin_config?: {
    min_significance?: number;
    max_batch_size?: number;
  };
}

export interface WireEvent {
  client_event_id: string;
  kind: 'manual_brag' | 'git_commit' | 'session_summary';
  occurred_at: string;
  significance: number;
  /** Pre-structured accomplishment; stored as-is by the backend. */
  title: string;
  summary: string;
  category?: string | null;
  impact?: string | null;
  context?: string | null;
  technologies?: string[];
  source: {
    tool: string;
    plugin_version: string;
    device_id: string;
    repo?: string;
    repo_hash?: string;
    branch?: string;
    commit_sha?: string;
    commit_message?: string;
    files_changed?: number;
    additions?: number;
    deletions?: number;
    session_duration_minutes?: number;
    evidence_commits?: string[];
  };
}

export interface BatchIngestRequest {
  events: WireEvent[];
}

export interface IngestResult {
  client_event_id: string;
  id: number | null;
  status: string;
  deduplicated: boolean;
  error?: string;
}

export interface BatchIngestResponse {
  ok: boolean;
  results: IngestResult[];
}

export interface EventStatusResponse {
  ok: boolean;
  id: number;
  status: string;
  user_confirmation_status?: string | null;
  amount_awarded?: number | null;
}

export interface DeviceAuthStartResponse {
  ok: boolean;
  code: string;
  /** High-entropy poll credential; never shown to the user. */
  device_secret: string;
  verify_url: string;
  expires_in: number;
  poll_interval: number;
}

export interface DeviceAuthPollResponse {
  ok: boolean;
  status: 'pending' | 'approved' | 'expired' | 'denied';
  token?: string;
  user_id?: number;
  email?: string;
}
