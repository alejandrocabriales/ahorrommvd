import { ConfigService } from '@nestjs/config';
import { WhatsAppSenderService } from './whatsapp-sender.service';

function buildConfig(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`Falta ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

describe('WhatsAppSenderService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to the Graph API with the phone number id in the URL and the token as bearer auth', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    global.fetch = fetchMock;

    const service = new WhatsAppSenderService(
      buildConfig({
        WHATSAPP_TOKEN: 'tok123',
        WHATSAPP_PHONE_NUMBER_ID: 'pn123',
      }),
    );
    await service.sendTextMessage('59891234567', 'hola');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/pn123/messages');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok123',
    );
    expect(JSON.parse(options.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '59891234567',
      type: 'text',
      text: { body: 'hola' },
    });
  });

  it('does not throw when the Graph API responds with an error (logs and returns instead)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid token'),
    });
    global.fetch = fetchMock;

    const service = new WhatsAppSenderService(
      buildConfig({ WHATSAPP_TOKEN: 'bad', WHATSAPP_PHONE_NUMBER_ID: 'pn123' }),
    );

    await expect(
      service.sendTextMessage('598', 'hola'),
    ).resolves.toBeUndefined();
  });
});
