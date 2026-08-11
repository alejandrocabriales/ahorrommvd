import {
  extractTextMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook-payload';

function textPayload(from: string, body: string): WhatsAppWebhookPayload {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from, type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

describe('extractTextMessage', () => {
  it('extracts sender and body from a real-shaped text message payload', () => {
    const payload = textPayload('59891234567', 'Ta-Ta Pocitos');

    expect(extractTextMessage(payload)).toEqual({
      from: '59891234567',
      text: 'Ta-Ta Pocitos',
    });
  });

  it('returns null for non-text messages (e.g. image/audio)', () => {
    const payload: WhatsAppWebhookPayload = {
      entry: [
        {
          changes: [{ value: { messages: [{ from: '598', type: 'image' }] } }],
        },
      ],
    };

    expect(extractTextMessage(payload)).toBeNull();
  });

  it('returns null for delivery/read status callbacks (no messages array)', () => {
    const payload: WhatsAppWebhookPayload = {
      entry: [{ changes: [{ value: {} }] }],
    };

    expect(extractTextMessage(payload)).toBeNull();
  });

  it('returns null for a malformed/empty payload', () => {
    expect(extractTextMessage({})).toBeNull();
  });
});
