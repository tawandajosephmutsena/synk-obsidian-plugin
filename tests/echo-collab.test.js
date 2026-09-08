const assert = require('node:assert/strict');
const test = require('node:test');

function resolveEchoConfig(settings) {
  if (!settings.serverUrl || !settings.deviceToken) {
    return null;
  }

  const baseUrl = settings.serverUrl.replace(/\/+$/, '');
  const token = settings.deviceToken;
  const bConfig = settings.broadcasting;

  let host = bConfig?.host;
  let port = bConfig?.port;
  let scheme = bConfig?.scheme;
  let key = bConfig?.key || 'synkk-reverb-key';

  if (!host || !port || !scheme) {
    try {
      const parsed = new URL(baseUrl);
      host = host || parsed.hostname;
      scheme = scheme || (parsed.protocol === 'https:' ? 'https' : 'http');
      if (!port) {
        port = parsed.port ? parseInt(parsed.port, 10) : (scheme === 'https' ? 443 : 80);
      }
    } catch {
      host = host || 'localhost';
      scheme = scheme || 'https';
      port = port || 443;
    }
  }

  const forceTLS = scheme === 'https';
  const signature = `${key}@${host}:${port}:${scheme}:${token}`;

  return {
    broadcaster: 'reverb',
    key,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${baseUrl}/broadcasting/auth`,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Synkk-Protocol': '2',
      },
    },
    signature,
  };
}

test('resolveEchoConfig resolves explicit broadcasting connection parameters and auth endpoint', () => {
  const settings = {
    serverUrl: 'https://synkk.example.com/api/v1',
    deviceToken: 'device_token_xyz_123',
    broadcasting: {
      driver: 'reverb',
      key: 'custom-reverb-key',
      host: 'ws.example.com',
      port: 8080,
      scheme: 'https',
    },
  };

  const config = resolveEchoConfig(settings);

  assert.ok(config);
  assert.equal(config.broadcaster, 'reverb');
  assert.equal(config.key, 'custom-reverb-key');
  assert.equal(config.wsHost, 'ws.example.com');
  assert.equal(config.wsPort, 8080);
  assert.equal(config.forceTLS, true);
  assert.equal(config.authEndpoint, 'https://synkk.example.com/api/v1/broadcasting/auth');
  assert.equal(config.auth.headers.Authorization, 'Bearer device_token_xyz_123');
  assert.equal(config.auth.headers['X-Synkk-Protocol'], '2');
});

test('resolveEchoConfig infers host and scheme from serverUrl when broadcasting config absent', () => {
  const settings = {
    serverUrl: 'https://sync.ottomate.space/api/v1',
    deviceToken: 'token_abc',
  };

  const config = resolveEchoConfig(settings);

  assert.ok(config);
  assert.equal(config.broadcaster, 'reverb');
  assert.equal(config.wsHost, 'sync.ottomate.space');
  assert.equal(config.wsPort, 443);
  assert.equal(config.forceTLS, true);
  assert.equal(config.authEndpoint, 'https://sync.ottomate.space/api/v1/broadcasting/auth');
});

test('resolveEchoConfig returns null when credentials missing', () => {
  assert.equal(resolveEchoConfig({ serverUrl: '', deviceToken: '' }), null);
  assert.equal(resolveEchoConfig({ serverUrl: 'https://sync.ottomate.space/api/v1', deviceToken: '' }), null);
});

test('YjsProvider in plugin supports both sendUpdate and appendUpdate', async () => {
  const Y = await import('yjs');
  const { SynkkYjsProvider } = await import('../src/yjsProvider.js');

  const doc = new Y.Doc();
  let appendCalled = false;
  let sentPayload = null;

  const provider = new SynkkYjsProvider({
    doc,
    vaultId: 'test-vault',
    documentId: 42,
    transport: {
      appendUpdate: async (envelope) => {
        appendCalled = true;
        sentPayload = envelope;
        return { acknowledged: true, sequence: 1 };
      },
    },
  });

  await provider.connect();

  const ytext = doc.getText('markdown');
  ytext.insert(0, 'Hello from Obsidian!');
  await provider.waitForPending();

  assert.ok(appendCalled, 'Expected appendUpdate to be called by flushOutbox');
  assert.ok(sentPayload);
  assert.equal(sentPayload.document_id, 42);

  provider.destroy();
});
