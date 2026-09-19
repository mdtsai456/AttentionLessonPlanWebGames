export interface GameCatalogEntry {
  gameType: string;
  doubleCapable: boolean;
}

interface GameCatalogResponse {
  games: GameCatalogEntry[];
}

export interface SessionPayload {
  lessonId: string;
  data: {
    grade: string;
    caseId: string;
    school: string;
    currentDay: number;
    startTime: number;
    endTime: number;
    mode?: 'single' | 'double';
    pairId?: string;
    stats: Array<{ apiname: string; value: number }>;
  };
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export class GameApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '', private readonly request: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  async health(): Promise<unknown> {
    return this.get('/health');
  }

  async games(): Promise<GameCatalogEntry[]> {
    const response = await this.get<GameCatalogResponse>('/api/games');
    return response.games;
  }

  async submitSession(payload: SessionPayload): Promise<{ sessionId?: string; message?: string }> {
    const response = await this.request(this.url('/api/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok && response.status !== 409) {
      throw new ApiError(response.status, await response.text());
    }
    return response.status === 409 ? {} : response.json() as Promise<{ sessionId?: string; message?: string }>;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(this.url(path));
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return response.json() as Promise<T>;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}
