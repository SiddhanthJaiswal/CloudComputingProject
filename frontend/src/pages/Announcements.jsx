import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function Announcements() {
  const { user } = useAuth();
  const canCreate = user.role === 'teacher' || user.role === 'admin';

  const [announcements, setAnnouncements] = useState([]);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', classId: '' });

  const load = async () => {
    try {
      const [a, c] = await Promise.all([api.get('/announcements'), api.get('/classes')]);
      setAnnouncements(a.announcements);
      setClasses(c.classes);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/announcements', {
        title: form.title,
        body: form.body,
        classId: form.classId || null
      });
      setForm({ title: '', body: '', classId: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/announcements/${id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Announcements</h2>
        {canCreate && <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New Announcement'}</button>}
      </div>
      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <form className="stacked-form" onSubmit={submit}>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea placeholder="Message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
          <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">{user.role === 'admin' ? 'School-wide' : 'Select a class'}</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit">Publish</button>
        </form>
      )}

      <div className="activity-list">
        {announcements.map((a) => (
          <div key={a.id} className="card">
            <div className="page-header">
              <h3>{a.title}</h3>
              {(user.role === 'admin' || a.createdBy === user.id) && (
                <button className="link-btn" onClick={() => remove(a.id)}>Delete</button>
              )}
            </div>
            <p className="muted">{a.className || 'School-wide'} — by {a.createdByName} — {new Date(a.createdAt).toLocaleDateString()}</p>
            <p>{a.body}</p>
          </div>
        ))}
        {announcements.length === 0 && <p className="muted">No announcements yet.</p>}
      </div>
    </div>
  );
}
