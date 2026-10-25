const jwt = require('jsonwebtoken');

// Session lifetime. The token expires after IDLE minutes; every authenticated
// request re-issues it (sliding window), so an active user stays signed in, but
// never past MAX hours from the original sign-in.
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 15;
const MAX_HOURS = Number(process.env.SESSION_MAX_HOURS) || 8;

// `tv` (token version) lets the server revoke every outstanding session for a
// user - it is bumped on logout and password change. `at` is the original
// sign-in time, carried across re-issues to enforce the absolute limit.
function signToken(user, authTime = Date.now()) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, tv: user.tokenVersion || 0, at: authTime },
    process.env.JWT_SECRET,
    { expiresIn: `${IDLE_MINUTES}m`, algorithm: 'HS256' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

module.exports = { signToken, verifyToken, IDLE_MINUTES, MAX_HOURS };
