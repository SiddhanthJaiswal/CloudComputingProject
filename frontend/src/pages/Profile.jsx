import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function Profile() {
  const { user, refresh } = useAuth();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const payload = { firstName, lastName };
      if (password) payload.password = password;
      await api.put(`/users/${user.id}`, payload);
      setPassword('');
      await refresh();
      setMessage('Profile updated.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h2>Profile</h2>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}
      <form className="stacked-form card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <label>Email</label>
        <input value={user.email} disabled />
        <label>Role</label>
        <input value={user.role} disabled />
        <label>First name</label>
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <label>Last name</label>
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        <label>New password (optional)</label>
        <input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep current password" />
        <p className="hint">At least 10 characters, with an uppercase letter, a lowercase letter and a number. Changing it signs you out on all other devices.</p>
        <button type="submit">Save changes</button>
      </form>
    </div>
  );
}
