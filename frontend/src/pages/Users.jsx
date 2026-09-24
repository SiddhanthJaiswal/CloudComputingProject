import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'teacher' });

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set('role', roleFilter);
      if (q) params.set('q', q);
      const r = await api.get(`/users?${params.toString()}`);
      setUsers(r.users);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [roleFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    load();
  };

  const createUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.register(form);
      setForm({ firstName: '', lastName: '', email: '', password: '', role: 'teacher' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleStatus = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { status: u.status === 'active' ? 'inactive' : 'active' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Users</h2>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'Add User'}</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={createUser}>
          <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input type="password" placeholder="Temp password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Teacher</option>
            <option value="parent">Parent</option>
            <option value="student">Student</option>
          </select>
          <button type="submit">Create</button>
        </form>
      )}

      <form className="inline-form" onSubmit={handleSearch}>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="teacher">Teacher</option>
          <option value="parent">Parent</option>
          <option value="student">Student</option>
        </select>
        <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Search</button>
      </form>

      <div className="card">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.firstName} {u.lastName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td className={u.status === 'active' ? 'status-present' : 'status-absent'}>{u.status}</td>
                <td><button className="link-btn" onClick={() => toggleStatus(u)}>{u.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="muted">No users found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
