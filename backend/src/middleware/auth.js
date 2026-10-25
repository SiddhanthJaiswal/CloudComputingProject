const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { doc } = require('../db/dynamo');
const { TABLES } = require('../db/tables');
const { verifyToken } = require('../utils/jwt');
const { readSessionToken, startSession, clearSession, MAX_HOURS } = require('../utils/session');

// Re-issue the cookie at most once a minute rather than on every request.
const REISSUE_AFTER_SECONDS = 60;

function unauthorized(res, code, error) {
  clearSession(res);
  return res.status(401).json({ error, code });
}

async function requireAuth(req, res, next) {
  const token = readSessionToken(req);
  if (!token) return unauthorized(res, 'NO_SESSION', 'Please sign in');

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return unauthorized(res, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  if (!payload.at || Date.now() - payload.at > MAX_HOURS * 3600 * 1000) {
    return unauthorized(res, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }

  try {
    // Checked on every request, so deactivating a user, a password change or a
    // logout elsewhere takes effect immediately rather than when the token expires.
    const result = await doc.send(new GetCommand({ TableName: TABLES.USERS, Key: { id: payload.sub } }));
    const user = result.Item;
    if (!user || user.status !== 'active' || (user.tokenVersion || 0) !== payload.tv) {
      return unauthorized(res, 'SESSION_REVOKED', 'Your session is no longer valid. Please sign in again.');
    }

    req.user = { id: user.id, role: user.role, email: user.email };
    req.session = { authTime: payload.at };

    if (Date.now() / 1000 - payload.iat > REISSUE_AFTER_SECONDS) {
      startSession(res, user, payload.at);
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
