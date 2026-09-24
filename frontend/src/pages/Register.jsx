import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'parent' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>ParentPulse</h1>
        <p className="auth-subtitle">Create your account</p>
        {error && <div className="alert error">{error}</div>}
        <label>First name</label>
        <input value={form.firstName} onChange={update('firstName')} required />
        <label>Last name</label>
        <input value={form.lastName} onChange={update('lastName')} required />
        <label>Email</label>
        <input type="email" value={form.email} onChange={update('email')} required />
        <label>Password</label>
        <input type="password" minLength={8} value={form.password} onChange={update('password')} required />
        <label>Role</label>
        <select value={form.role} onChange={update('role')}>
          <option value="parent">Parent</option>
          <option value="teacher">Teacher</option>
          <option value="student">Student</option>
        </select>
        <p className="hint">Admin accounts are created by an existing administrator, not by self-registration.</p>
        <button type="submit" disabled={busy}>{busy ? 'Creating account...' : 'Register'}</button>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
