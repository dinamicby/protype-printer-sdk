import { describe, expect, test } from 'vitest';
import { MoonrakerClient } from '../moonraker-client';

/** authHeader приватный — публичного API у него нет, дёргаем через сигнатуру. */
const authHeaderOf = (client: MoonrakerClient): Record<string, string> =>
  (client as unknown as { authHeader: () => Record<string, string> }).authHeader();

const clientWith = (extra: Record<string, unknown>) =>
  new MoonrakerClient({ baseUrl: 'http://printer.test', mode: 'remote', ...extra } as never);

describe('authHeader', () => {
  test('без токена и без ключа не шлёт ничего', () => {
    expect(authHeaderOf(clientWith({}))).toEqual({});
  });

  test('токен даёт Bearer', () => {
    const headers = authHeaderOf(clientWith({ getAuthToken: () => 'jwt-abc' }));
    expect(headers).toEqual({ Authorization: 'Bearer jwt-abc' });
  });

  test('ключ даёт X-Api-Key', () => {
    const headers = authHeaderOf(clientWith({ getApiKey: () => 'key-xyz' }));
    expect(headers).toEqual({ 'X-Api-Key': 'key-xyz' });
  });

  test('оба заголовка уживаются вместе', () => {
    const headers = authHeaderOf(
      clientWith({ getAuthToken: () => 'jwt-abc', getApiKey: () => 'key-xyz' }),
    );
    expect(headers).toEqual({ Authorization: 'Bearer jwt-abc', 'X-Api-Key': 'key-xyz' });
  });

  test('пустая строка ключа заголовка не даёт', () => {
    expect(authHeaderOf(clientWith({ getApiKey: () => '' }))).toEqual({});
  });

  test('ключ читается заново на каждый вызов', () => {
    let key = 'first';
    const client = clientWith({ getApiKey: () => key });
    expect(authHeaderOf(client)).toEqual({ 'X-Api-Key': 'first' });
    key = 'second';
    expect(authHeaderOf(client)).toEqual({ 'X-Api-Key': 'second' });
  });
});
