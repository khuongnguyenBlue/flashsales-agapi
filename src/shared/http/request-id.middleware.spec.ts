import { IncomingMessage, ServerResponse } from 'http';
import { RequestIdMiddleware } from './request-id.middleware';

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as ServerResponse & { headers: Record<string, string> };
}

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('reuses an existing x-request-id header', () => {
    const req = makeReq({ 'x-request-id': 'existing-id' });
    const res = makeRes();
    middleware.use(req, res, () => undefined);

    expect(req.headers['x-request-id']).toBe('existing-id');
    expect(res.headers['x-request-id']).toBe('existing-id');
  });

  it('generates a 26-char ULID when header is absent', () => {
    const req = makeReq();
    const res = makeRes();
    middleware.use(req, res, () => undefined);

    const id = req.headers['x-request-id'] as string;
    expect(id).toHaveLength(26);
    expect(res.headers['x-request-id']).toBe(id);
  });
});
