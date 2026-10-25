import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthShell from '../components/AuthShell';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'parent' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await register(form);
      if (result.pending) {
        setPendingMessage(result.message);
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create your account</h1>
        <p className="auth-subtitle">Join your school on ParentPulse</p>
        {error && <div className="alert error">{error}</div>}
        {pendingMessage && <div className="alert success">{pendingMessage}</div>}
        <div className="field-row">
          <div>
            <label>First name</label>
            <input value={form.firstName} onChange={update('firstName')} required />
          </div>
          <div>
            <label>Last name</label>
            <input value={form.lastName} onChange={update('lastName')} required />
          </div>
        </div>
        <label>Email</label>
        <input type="email" value={form.email} onChange={update('email')} required />
        <label>Password</label>
        <input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={update('password')} required />
        <p className="hint">At least 10 characters, with an uppercase letter, a lowercase letter and a number.</p>
        <label>Role</label>
        <select value={form.role} onChange={update('role')}>
          <option value="parent">Parent</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
        <p className="hint">Teacher accounts need administrator approval before first sign-in. Admin accounts are created by an existing administrator.</p>
        <button type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
