// ── Web Push sender — RFC 8292 (VAPID) + RFC 8291 (message encryption) ─────────
// Pure Web Crypto API; no npm packages required (CF Workers compatible).

function b64uDecode(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function b64uEncode(bytes) {
  // Chunk to avoid spread-operator call-stack limit on large arrays
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/[/]/g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// HKDF-Extract(salt, ikm) = HMAC-SHA256(key=salt, data=ikm)
async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

// HKDF-Expand single round (length <= 32): HMAC-SHA256(key=prk, data=info || 0x01)[0:length]
async function hkdfExpand(prk, info, length) {
  const T = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return T.slice(0, length);
}

// Sign a VAPID JWT (RFC 8292) using the stored JWK private key
async function buildVapidJwt(env, audience) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const privateKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const header  = { typ: 'JWT', alg: 'ES256' };
  const claims  = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 hours
    sub: env.VAPID_CONTACT || 'mailto:info@timothystl.org',
  };

  const enc     = new TextEncoder();
  const h64     = b64uEncode(enc.encode(JSON.stringify(header)));
  const c64     = b64uEncode(enc.encode(JSON.stringify(claims)));
  const signing = h64 + '.' + c64;

  // Web Crypto ECDSA returns IEEE P1363 (raw r||s, 64 bytes for P-256)
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(signing)
  ));

  return signing + '.' + b64uEncode(sig);
}

// Encrypt payload per RFC 8291 + RFC 8188 (aes128gcm content encoding)
async function encryptPayload(plaintext, p256dhB64u, authB64u) {
  const receiverPub = b64uDecode(p256dhB64u); // 65-byte uncompressed P-256 point
  const authSecret  = b64uDecode(authB64u);   // 16-byte auth secret

  // Sender's ephemeral ECDH key pair
  const senderKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', senderKp.publicKey));

  // Import receiver public key for ECDH
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret (256 bits = 32 bytes)
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKp.privateKey, 256)
  );

  // RFC 8291 key derivation:
  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const prk = await hkdfExtract(authSecret, ecdhSecret);

  // IKM = HKDF-Expand(PRK, "WebPush: info\0" || receiver_pub || sender_pub, 32)
  const enc = new TextEncoder();
  const keyInfo = concat(enc.encode('WebPush: info\0'), receiverPub, senderPub);
  const ikm = await hkdfExpand(prk, keyInfo, 32);

  // 16-byte random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8188 content encryption key derivation:
  // PRK_content = HKDF-Extract(salt, ikm)
  const prkContent = await hkdfExtract(salt, ikm);

  // CEK = HKDF-Expand(PRK_content, "Content-Encoding: aes128gcm\0", 16)
  const cek   = await hkdfExpand(prkContent, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  // Nonce = HKDF-Expand(PRK_content, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdfExpand(prkContent, enc.encode('Content-Encoding: nonce\0'), 12);

  // Plaintext → AES-128-GCM. Append 0x02 delimiter (single-record, last record).
  const msg = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const padded = concat(msg, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  );

  // RFC 8188 header: salt(16) + rs(4, BE uint32=4096) + keyid_len(1) + sender_pub(65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(senderPub, 21);

  return concat(header, ciphertext);
}

// Send one Web Push notification to a single subscription.
// notification: { title, body, tag?, url? }
// subscription: parsed PushSubscription JSON (or its string)
export async function sendWebPush(subscription, notification, env) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return { error: 'VAPID keys not configured' };

  let sub;
  try { sub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription; }
  catch { return { error: 'Invalid subscription JSON' }; }

  const { endpoint, keys } = sub || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return { error: 'Invalid subscription structure' };

  const audience = new URL(endpoint).origin;
  let jwt;
  try { jwt = await buildVapidJwt(env, audience); }
  catch (e) { return { error: 'VAPID JWT build failed: ' + e.message }; }

  const payload = JSON.stringify(notification);
  let body;
  try { body = await encryptPayload(payload, keys.p256dh, keys.auth); }
  catch (e) { return { error: 'Encryption failed: ' + e.message }; }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
      },
      body,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { error: 'Fetch failed: ' + e.message };
  }
}

// Send to all subscribers in the DB. Returns { sent, failed, skipped }.
export async function broadcastWebPush(notification, env) {
  const rows = await env.DB.prepare(
    "SELECT id, push_subscription FROM app_users WHERE push_subscription != '' AND active=1"
  ).all();
  const subs = rows.results || [];

  let sent = 0, failed = 0, skipped = 0;
  for (const row of subs) {
    let sub;
    try { sub = JSON.parse(row.push_subscription); } catch { skipped++; continue; }
    if (!sub?.endpoint) { skipped++; continue; }

    const result = await sendWebPush(sub, notification, env).catch(() => ({ error: 'exception' }));
    if (result.ok) {
      sent++;
    } else if (result.status === 410 || result.status === 404) {
      // Subscription expired — clean up
      await env.DB.prepare("UPDATE app_users SET push_subscription='' WHERE id=?").bind(row.id).run().catch(() => {});
      skipped++;
    } else {
      failed++;
    }
  }
  return { sent, failed, skipped };
}
