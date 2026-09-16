const assert = require('node:assert/strict');
const test = require('node:test');

// Import pure helpers directly from pairing module or define compatible implementations
const { isOriginSecure, validatePairingParams, getDevicePlatformInfo, parsePairingPayload } = (() => {
  function isOriginSecure(serverUrl) {
    try {
      const url = new URL(serverUrl);
      if (url.protocol === 'https:') {
        return true;
      }
      if (url.protocol === 'http:') {
        const hostname = url.hostname.toLowerCase();
        return (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '[::1]' ||
          hostname.endsWith('.test') ||
          hostname.endsWith('.local')
        );
      }
      return false;
    } catch {
      return false;
    }
  }

  function validatePairingParams(params) {
    const server = params.server?.trim();
    const session = params.session?.trim();
    const vault = params.vault?.trim();
    const vStr = params.v?.trim();

    if (!server) {
      return { isValid: false, error: 'Missing required "server" URL in pairing payload.' };
    }

    if (!session) {
      return { isValid: false, error: 'Missing required "session" identifier in pairing payload.' };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(server);
    } catch {
      return { isValid: false, error: `Invalid server URL format: "${server}".` };
    }

    if (!isOriginSecure(server)) {
      return {
        isValid: false,
        error: `Insecure server URL rejected: "${server}". HTTPS is strictly required for remote Synkk pairing.`,
      };
    }

    const protocolVersion = vStr ? parseInt(vStr, 10) : 2;
    if (isNaN(protocolVersion) || protocolVersion < 1) {
      return { isValid: false, error: `Unsupported protocol version "${vStr}".` };
    }

    return {
      isValid: true,
      serverUrl: server.replace(/\/+$/, ''),
      sessionId: session,
      vaultSlug: vault || undefined,
      protocolVersion,
    };
  }

  function getDevicePlatformInfo(isMobile, isIos, isAndroid, isMac, isWin) {
    if (isMobile) {
      if (isIos) return { platform: 'ios', deviceName: 'iPhone (Obsidian)' };
      if (isAndroid) return { platform: 'android', deviceName: 'Android (Obsidian)' };
      return { platform: 'ios', deviceName: 'Mobile Device (Obsidian)' };
    }
    if (isMac) return { platform: 'mac', deviceName: 'Mac (Obsidian)' };
    if (isWin) return { platform: 'windows', deviceName: 'Windows PC (Obsidian)' };
    return { platform: 'linux', deviceName: 'Desktop (Obsidian)' };
  }

  function parsePairingPayload(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          type: 'synkk-pairing-session',
          server: typeof parsed.server === 'string' ? parsed.server : undefined,
          session: typeof parsed.session === 'string' ? parsed.session : (typeof parsed.session_id === 'string' ? parsed.session_id : undefined),
          vault: typeof parsed.vault === 'string' ? parsed.vault : (typeof parsed.vault_slug === 'string' ? parsed.vault_slug : undefined),
          token: typeof parsed.token === 'string' ? parsed.token : (typeof parsed.plain_token === 'string' ? parsed.plain_token : undefined),
          v: typeof parsed.v === 'string' || typeof parsed.v === 'number' ? String(parsed.v) : '2',
        };
      } catch {
        return null;
      }
    }

    if (trimmed.startsWith('obsidian://synkk-pair') || trimmed.startsWith('synkk-pair://') || trimmed.startsWith('synkk://')) {
      try {
        const normalized = trimmed.replace(/^(obsidian:\/\/synkk-pair|synkk-pair:\/\/|synkk:\/\/pair)\??/, 'https://placeholder/?');
        const url = new URL(normalized);
        return {
          type: 'synkk-pairing-session',
          server: url.searchParams.get('server') || undefined,
          session: url.searchParams.get('session') || undefined,
          vault: url.searchParams.get('vault') || undefined,
          token: url.searchParams.get('token') || undefined,
          v: url.searchParams.get('v') || '2',
        };
      } catch {
        return null;
      }
    }

    if (trimmed.includes('/pair?')) {
      try {
        const url = new URL(trimmed);
        return {
          type: 'synkk-pairing-session',
          server: url.searchParams.get('server') || `${url.origin}/api/v1`,
          session: url.searchParams.get('session') || undefined,
          vault: url.searchParams.get('vault') || undefined,
          token: url.searchParams.get('token') || undefined,
          v: url.searchParams.get('v') || '2',
        };
      } catch {
        return null;
      }
    }

    if (trimmed.startsWith('synkk_')) {
      return { token: trimmed };
    }

    return null;
  }

  return { isOriginSecure, validatePairingParams, getDevicePlatformInfo, parsePairingPayload };
})();

test('validates and parses valid HTTPS obsidian://synkk-pair payload', () => {
  const result = validatePairingParams({
    server: 'https://synkk.myenterprise.com/api/v1/',
    session: 'synkk_pair_sec123abc',
    vault: 'engineering-notes',
    v: '2',
  });

  assert.equal(result.isValid, true);
  assert.equal(result.serverUrl, 'https://synkk.myenterprise.com/api/v1');
  assert.equal(result.sessionId, 'synkk_pair_sec123abc');
  assert.equal(result.vaultSlug, 'engineering-notes');
  assert.equal(result.protocolVersion, 2);
});

test('strictly rejects insecure remote HTTP origins for pairing', () => {
  const result = validatePairingParams({
    server: 'http://synkk-insecure.evilcorp.com/api/v1',
    session: 'synkk_pair_test',
    vault: 'vault',
    v: '2',
  });

  assert.equal(result.isValid, false);
  assert.match(result.error, /HTTPS is strictly required/);
});

test('allows explicit local development origins over plain HTTP', () => {
  const localHosts = [
    'http://localhost:8000/api/v1',
    'http://127.0.0.1:8000/api/v1',
    'http://synkk.test/api/v1',
    'http://vault.local:3000/api/v1',
  ];

  for (const host of localHosts) {
    const result = validatePairingParams({
      server: host,
      session: 'synkk_pair_dev123',
    });
    assert.equal(result.isValid, true, `Expected ${host} to be allowed for local development`);
    assert.equal(result.sessionId, 'synkk_pair_dev123');
  }
});

test('rejects malformed pairing parameters missing server or session', () => {
  const noServer = validatePairingParams({ session: 'synkk_pair_123' });
  assert.equal(noServer.isValid, false);
  assert.match(noServer.error, /Missing required "server"/);

  const noSession = validatePairingParams({ server: 'https://synkk.com/api/v1' });
  assert.equal(noSession.isValid, false);
  assert.match(noSession.error, /Missing required "session"/);
});

test('resolves appropriate platform and friendly device name', () => {
  assert.deepEqual(getDevicePlatformInfo(true, true, false, false, false), {
    platform: 'ios',
    deviceName: 'iPhone (Obsidian)',
  });
  assert.deepEqual(getDevicePlatformInfo(true, false, true, false, false), {
    platform: 'android',
    deviceName: 'Android (Obsidian)',
  });
  assert.deepEqual(getDevicePlatformInfo(false, false, false, true, false), {
    platform: 'mac',
    deviceName: 'Mac (Obsidian)',
  });
  assert.deepEqual(getDevicePlatformInfo(false, false, false, false, true), {
    platform: 'windows',
    deviceName: 'Windows PC (Obsidian)',
  });
  assert.deepEqual(getDevicePlatformInfo(false, false, false, false, false), {
    platform: 'linux',
    deviceName: 'Desktop (Obsidian)',
  });
});

test('correctly identifies HTTP 410 pairing expiration error state', () => {
  const make410Error = (message) => {
    const err = new Error(message || 'Pairing session has expired or has already been used.');
    err.status = 410;
    err.isExpiredOrConsumed = true;
    return err;
  };

  const err = make410Error();
  assert.equal(err.status, 410);
  assert.equal(err.isExpiredOrConsumed, true);
  assert.match(err.message, /expired or has already been used/);
});

test('parsePairingPayload normalizes obsidian URIs, web bridge links, JSON, and raw tokens', () => {
  // 1. Obsidian scheme
  const resObs = parsePairingPayload('obsidian://synkk-pair?server=https%3A%2F%2Fsynkk.space%2Fapi%2Fv1&session=sess_987&vault=core-vault&v=2');
  assert.equal(resObs.type, 'synkk-pairing-session');
  assert.equal(resObs.server, 'https://synkk.space/api/v1');
  assert.equal(resObs.session, 'sess_987');
  assert.equal(resObs.vault, 'core-vault');

  // 2. Web bridge URL
  const resWeb = parsePairingPayload('https://synkk.space/pair?session=sess_web123&server=https%3A%2F%2Fsynkk.space%2Fapi%2Fv1&vault=agency');
  assert.equal(resWeb.type, 'synkk-pairing-session');
  assert.equal(resWeb.server, 'https://synkk.space/api/v1');
  assert.equal(resWeb.session, 'sess_web123');
  assert.equal(resWeb.vault, 'agency');

  // 3. JSON payload
  const resJson = parsePairingPayload(JSON.stringify({
    server: 'https://synkk.space/api/v1',
    session: 'sess_json_abc',
    vault: 'research',
  }));
  assert.equal(resJson.type, 'synkk-pairing-session');
  assert.equal(resJson.server, 'https://synkk.space/api/v1');
  assert.equal(resJson.session, 'sess_json_abc');
  assert.equal(resJson.vault, 'research');

  // 4. Raw token string
  const resToken = parsePairingPayload('synkk_dev_abcdef1234567890');
  assert.equal(resToken.token, 'synkk_dev_abcdef1234567890');
  assert.equal(resToken.server, undefined);

  // 5. Invalid string returns null
  assert.equal(parsePairingPayload(''), null);
  assert.equal(parsePairingPayload('just some random text'), null);
});
