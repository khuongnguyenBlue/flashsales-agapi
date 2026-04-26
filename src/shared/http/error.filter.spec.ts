import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AppErrorFilter } from './error.filter';
import { AppHttpException } from './app-http.exception';

function makeHost(requestId?: string) {
  const sent: { status: number; body: unknown }[] = [];
  const req = { headers: { 'x-request-id': requestId } };
  const res = {
    status(s: number) {
      return { send: (b: unknown) => sent.push({ status: s, body: b }) };
    },
  };
  return {
    sent,
    host: {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as Parameters<AppErrorFilter['catch']>[1],
  };
}

describe('AppErrorFilter', () => {
  const filter = new AppErrorFilter();

  it('maps BadRequestException with array message to validation_failed', () => {
    const { sent, host } = makeHost('req-1');
    filter.catch(new BadRequestException(['field is required']), host);

    expect(sent[0].status).toBe(400);
    expect((sent[0].body as { error: { code: string } }).error.code).toBe('validation_failed');
    expect(
      (sent[0].body as { error: { details: { issues: string[] } } }).error.details.issues,
    ).toContain('field is required');
  });

  it('passes AppHttpException through with its code', () => {
    const { sent, host } = makeHost('req-2');
    filter.catch(new AppHttpException('sold_out', 'No stock remaining', HttpStatus.CONFLICT), host);

    expect(sent[0].status).toBe(409);
    expect((sent[0].body as { error: { code: string } }).error.code).toBe('sold_out');
  });

  it('maps a bare Error to 500 internal_error', () => {
    const { sent, host } = makeHost('req-3');
    filter.catch(new Error('unexpected'), host);

    expect(sent[0].status).toBe(500);
    expect((sent[0].body as { error: { code: string } }).error.code).toBe('internal_error');
  });
});
