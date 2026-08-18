import type {
  BatchIngestRequest,
  BatchIngestResponse,
  DeviceAuthPollResponse,
  DeviceAuthStartResponse,
  EventStatusResponse,
  MeResponse,
} from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Minimal HTTP client for the BragVault plugin API. */
export class BragvaultClient {
  constructor(
    private readonly endpoint: string,
    private readonly token?: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, authed = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authed) {
      if (!this.token) throw new ApiError('Not connected to a BragVault account', 401);
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new ApiError('Request timed out', 0);
      }
      throw err;
    }
    if (!res.ok) {
      let detail = '';
      try {
        const data = (await res.json()) as { error?: string };
        detail = data.error ?? '';
      } catch {
        // non-JSON error body
      }
      throw new ApiError(detail || `HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/api/plugin/me');
  }

  ingestBatch(batch: BatchIngestRequest): Promise<BatchIngestResponse> {
    return this.request<BatchIngestResponse>('POST', '/api/plugin/events/batch', batch);
  }

  eventStatus(id: number): Promise<EventStatusResponse> {
    return this.request<EventStatusResponse>('GET', `/api/plugin/events/${id}/status`);
  }

  deviceAuthStart(deviceName: string): Promise<DeviceAuthStartResponse> {
    return this.request<DeviceAuthStartResponse>('POST', '/api/plugin/device-auth/start', { device_name: deviceName }, false);
  }

  deviceAuthPoll(code: string, deviceSecret: string): Promise<DeviceAuthPollResponse> {
    return this.request<DeviceAuthPollResponse>(
      'POST',
      '/api/plugin/device-auth/poll',
      { code, device_secret: deviceSecret },
      false,
    );
  }
}
