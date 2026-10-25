// Password policy for every new or changed password.
const MIN_LENGTH = 10;

function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters`;
  }
  if (password.length > 128) return 'Password must be at most 128 characters';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include an uppercase letter, a lowercase letter and a number';
  }
  return null;
}

module.exports = { passwordPolicyError, MIN_LENGTH };
