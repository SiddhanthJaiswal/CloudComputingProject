const { signToken, IDLE_MINUTES, MAX_HOURS } = require('./jwt');

// The session token lives in an HttpOnly cookie so page scripts (and therefore
// any injected script) can never read it. SameSite=Strict keeps it off
// cross-site requests, which is the CSRF defence for this same-origin app.
const COOKIE_NAME = 'pp_session';
const COOKIE_PATH = '/api';
const isProduction = () => process.env.NODE_ENV === 'production';

function cookieAttributes(maxAgeSeconds) {
  const attrs = [`Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (isProduction()) attrs.push('Secure');
  return attrs.join('; ');
}

// Issues (or re-issues) the session cookie. Returns the session info the
// frontend uses to drive its inactivity timer.
function startSession(res, user, authTime = Date.now()) {
  const token = signToken(user, authTime);
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieAttributes(IDLE_MINUTES * 60)}`);
  return sessionInfo(authTime);
}

function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes(0)}`);
}

function sessionInfo(authTime) {
  return {
    idleMinutes: IDLE_MINUTES,
    expiresAt: new Date(authTime + MAX_HOURS * 3600 * 1000).toISOString()
  };
}

function readSessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

module.exports = { startSession, clearSession, sessionInfo, readSessionToken, MAX_HOURS };
