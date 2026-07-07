import {describe, test, expect} from 'vitest';
import {httpErrorMessage} from '../moonraker-client';

describe('httpErrorMessage', () => {
  test('digs Moonraker error.message out of a JSON body', () => {
    const body = JSON.stringify({error: {code: 400, message: 'Unknown command:SAVE_VARIABLE'}});
    expect(httpErrorMessage(404, body)).toBe('HTTP 404: Unknown command:SAVE_VARIABLE');
  });

  test('falls back to top-level message field', () => {
    expect(httpErrorMessage(500, JSON.stringify({message: 'boom'}))).toBe('HTTP 500: boom');
  });

  test('uses raw body when it is not JSON', () => {
    expect(httpErrorMessage(400, 'plain text error')).toBe('HTTP 400: plain text error');
  });

  test('falls back to statusText when body is empty', () => {
    expect(httpErrorMessage(404, '', 'Not Found')).toBe('HTTP 404: Not Found');
  });

  test('returns bare status when nothing usable is available', () => {
    expect(httpErrorMessage(503)).toBe('HTTP 503');
  });

  test('truncates very long detail', () => {
    const long = 'x'.repeat(500);
    const out = httpErrorMessage(400, long);
    expect(out.startsWith('HTTP 400: ')).toBe(true);
    expect(out.length).toBeLessThan(320);
    expect(out.endsWith('…')).toBe(true);
  });
});
