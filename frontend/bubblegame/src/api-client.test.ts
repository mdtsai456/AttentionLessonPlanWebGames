import { describe, expect, it, vi } from 'vitest';
import { GameApiClient, type SessionPayload } from './api-client';

const payload: SessionPayload = {
  lessonId: 'test_DAT',
  data: {
    grade: 'G1',
    caseId: 'TEST-001',
    school: 'KMU',
    currentDay: 1,
    startTime: 1725000000000,
    endTime: 1725000060000,
    stats: [
      { apiname: 'DAT_correct', value: 1 },
      { apiname: 'DAT_wrong', value: 0 },
      { apiname: 'DAT_accuracy', value: 1 },
      { apiname: 'DAT_duration', value: 60000 },
      { apiname: 'DAT_stage', value: 1 },
    ],
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GameApiClient', () => {
  it('calls health and unwraps the games catalog', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ status: 'ok' }))
      .mockResolvedValueOnce(response({ games: [{ gameType: 'DAT', doubleCapable: true }] }));
    const client = new GameApiClient('http://127.0.0.1:5001/', request);

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
    await expect(client.games()).resolves.toEqual([{ gameType: 'DAT', doubleCapable: true }]);
    expect(request).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:5001/health');
    expect(request).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:5001/api/games');
  });

  it('submits a session and treats 409 as already received', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ sessionId: 'session-1', message: '已接收' }, 201))
      .mockResolvedValueOnce(response({ detail: '場次已存在' }, 409));
    const client = new GameApiClient('http://127.0.0.1:5001', request);

    await expect(client.submitSession(payload)).resolves.toEqual({ sessionId: 'session-1', message: '已接收' });
    await expect(client.submitSession(payload)).resolves.toEqual({});
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:5001/api/sessions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload),
    }));
  });

  it('exposes HTTP failures and network failures to the caller', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ detail: '未知的場域' }, 400))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new GameApiClient('http://127.0.0.1:5001', request);

    await expect(client.submitSession(payload)).rejects.toMatchObject({ status: 400 });
    await expect(client.health()).rejects.toThrow('Failed to fetch');
  });
});
