/**
 * Read-only NKERP client.
 *
 * The NKERP API has GET routes that change data, so nothing here is generic:
 * every path this client can call is on an explicit allowlist of list/search
 * reads. There is no save, release, email or status call in this file.
 *
 * Credentials come from the environment (NKERP_LOGIN_ID / NKERP_PASSWORD) and
 * are never logged or returned to the browser.
 */

const DEFAULT_BASE = 'https://to.najafkarbala.com/NKERPApi/';

/** POST searches that only read. */
export const READ_POSTS = new Set([
  // General search → Groups: every tour of the office with its sub-venue plans and flights.
  'api/tours/GeneralSearchGroups',
]);

/** GET reads, by exact shape (some NKERP GET routes change data, so nothing else is allowed). */
export const READ_GETS = [
  // A tour's guest list, one row per person, with their accommodation choice.
  /^api\/tours\/getApplicants\/\d{1,12}$/,
  // A tour's sub-venue plans, every version. Used for tours awaiting re-approval,
  // which General search lists with no plans.
  /^api\/tours\/getTourSubVenue\/\d{1,12}$/,
];

export const isAllowedRead = (path, method) =>
  method === 'GET' ? READ_GETS.some((pattern) => pattern.test(path)) : READ_POSTS.has(path);

/** Scheduling role that can read Najaf once Najaf is selected. */
const PREFERRED_ROLE = '13';

export class NkerpError extends Error {
  constructor(message, { status = 502, code = 'nkerp' } = {}) {
    super(message);
    this.name = 'NkerpError';
    this.status = status;
    this.code = code;
  }
}

export class NkerpClient {
  #loginId;
  #password;
  #cookies = new Map();
  #loginPromise = null;
  #loggedInAt = 0;

  constructor({ loginId, password, baseUrl = DEFAULT_BASE, timeoutMs = 60_000, fetchImpl = fetch } = {}) {
    this.#loginId = loginId;
    this.#password = password;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.origin = new URL(this.baseUrl).origin;
    this.timeoutMs = timeoutMs;
    // Called as a plain function: Cloudflare Workers reject fetch with another `this`.
    this.fetch = (url, init) => fetchImpl(url, init);
    this.userId = null;
    this.groupId = null;
    this.requests = 0;
  }

  get configured() {
    return Boolean(this.#loginId && this.#password);
  }

  #cookieHeader() {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #storeCookies(response) {
    const headers = response.headers;
    const list =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : typeof headers.getAll === 'function'
          ? headers.getAll('Set-Cookie')
          : (headers.get('set-cookie') ?? '').split(/,(?=\s*[^;=,\s]+=)/);
    for (const line of list) {
      const pair = line.split(';', 1)[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.#cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async #raw(path, body, { signal } = {}) {
    if (!path.startsWith('api/') || path.includes('://')) throw new NkerpError('Expected a relative NKERP API path');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: this.origin,
      Referer: `${this.origin}/`,
    };
    const cookie = this.#cookieHeader();
    if (cookie) headers.Cookie = cookie;
    this.requests += 1;
    let response;
    try {
      response = await this.fetch(this.baseUrl + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      console.error('[nkerp] request failed', path, error?.name, error?.message, error?.cause?.message ?? '');
      throw new NkerpError(`NKERP did not answer (${error?.name === 'TimeoutError' ? 'timed out' : 'network error'})`, {
        status: 504,
        code: 'unreachable',
      });
    }
    this.#storeCookies(response);
    if (response.status === 401) throw new NkerpError('NKERP session expired', { status: 401, code: 'unauthorized' });
    if (!response.ok) throw new NkerpError(`NKERP answered HTTP ${response.status}`, { code: 'http' });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new NkerpError('NKERP sent a reply that is not JSON', { code: 'format' });
    }
    if (data && typeof data === 'object' && data.IsError) {
      throw new NkerpError('NKERP rejected the request', { code: 'rejected' });
    }
    return data;
  }

  /** Signs in once and reuses the session; `force` starts a fresh one. */
  async login({ force = false, signal } = {}) {
    if (!this.configured) {
      throw new NkerpError('NKERP sign-in is not set up on the server (NKERP_LOGIN_ID / NKERP_PASSWORD)', {
        status: 503,
        code: 'not-configured',
      });
    }
    const fresh = Date.now() - this.#loggedInAt < 20 * 60_000;
    if (!force && this.userId !== null && fresh) return { reused: true };
    if (this.#loginPromise) return this.#loginPromise;
    this.#loginPromise = (async () => {
      this.#cookies.clear();
      this.userId = null;
      const result = await this.#raw(
        'api/accounts/Login',
        { LocalUTCTime: new Date().toISOString(), LoginId: this.#loginId, Password: this.#password },
        { signal },
      );
      if (!result?.ReturnStatus || !result?.IsAuthenicated) {
        throw new NkerpError('NKERP did not accept the sign-in', { status: 502, code: 'login-failed' });
      }
      const roles = String(result.Role ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!roles.length) throw new NkerpError('The NKERP account has no role assigned', { code: 'no-role' });
      this.userId = result.UserId;
      this.groupId = Number(roles.includes(PREFERRED_ROLE) ? PREFERRED_ROLE : roles[0]);
      await this.#raw(`api/user/GetSectionIdByGroupId/${this.groupId}`, undefined, { signal });
      this.#cookies.set('GroupId', String(this.groupId));
      this.#cookies.set('UserId', String(this.userId));
      this.#loggedInAt = Date.now();
      return { reused: false };
    })();
    try {
      return await this.#loginPromise;
    } finally {
      this.#loginPromise = null;
    }
  }

  /** One allowlisted read: a POST search with `body`, or a GET when `body` is undefined. Signs in again once if the session has expired. */
  async read(path, body, { signal } = {}) {
    if (!isAllowedRead(path, body === undefined ? 'GET' : 'POST')) {
      throw new NkerpError(`"${path}" is not on the read-only allowlist`, { status: 500 });
    }
    await this.login({ signal });
    try {
      return await this.#raw(path, body, { signal });
    } catch (error) {
      if (error instanceof NkerpError && error.code === 'unauthorized') {
        await this.login({ force: true, signal });
        return this.#raw(path, body, { signal });
      }
      throw error;
    }
  }
}

let shared = null;

/**
 * One client per server process (or Worker isolate) so the NKERP session is
 * reused across pulls. `env` holds NKERP_LOGIN_ID / NKERP_PASSWORD: process.env
 * on Node, the Worker's secrets on Cloudflare.
 */
export function sharedClient(env = globalThis.process?.env ?? {}) {
  const loginId = env.NKERP_LOGIN_ID;
  if (!shared || shared.loginId !== loginId) {
    shared = new NkerpClient({ loginId, password: env.NKERP_PASSWORD, baseUrl: env.NKERP_BASE_URL || DEFAULT_BASE });
    shared.loginId = loginId;
  }
  return shared;
}
