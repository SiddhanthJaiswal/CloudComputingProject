import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function Students() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';

  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [studentUsers, setStudentUsers] = useState([]);
  const [parentUsers, setParentUsers] = useState([]);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({});
  const [linkedParents, setLinkedParents] = useState({});
  const [linkFormFor, setLinkFormFor] = useState(null);
  const [selectedParentId, setSelectedParentId] = useState('');

  const [form, setForm] = useState({ userId: '', classId: '', rollNumber: '' });
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    try {
      const requests = [api.get('/students'), api.get('/classes')];
      if (isAdmin) {
        requests.push(api.get('/users?role=student'), api.get('/parents'));
      }
      const [s, c, su, pu] = await Promise.all(requests);
      setStudents(s.students);
      setClasses(c.classes);
      if (isAdmin) {
        setStudentUsers(su.users);
        setParentUsers(pu.parents);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const loadSummary = async (id) => {
    if (summary[id]) return;
    try {
      const s = await api.get(`/attendance/summary/${id}`);
      setSummary((prev) => ({ ...prev, [id]: s }));
    } catch {
      // ignore, e.g. no attendance yet
    }
  };

  const loadParents = async (studentId) => {
    try {
      const r = await api.get(`/students/${studentId}/parents`);
      setLinkedParents((prev) => ({ ...prev, [studentId]: r.parents }));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (isAdmin) students.forEach((s) => loadParents(s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, isAdmin]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/students', {
        userId: form.userId,
        classId: form.classId || null,
        rollNumber: form.rollNumber
      });
      setForm({ userId: '', classId: '', rollNumber: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openLinkForm = (studentId) => {
    setLinkFormFor(linkFormFor === studentId ? null : studentId);
    setSelectedParentId('');
  };

  const handleLinkParent = async (studentId) => {
    if (!selectedParentId) return;
    setError('');
    try {
      await api.post(`/students/${studentId}/link-parent`, { parentId: selectedParentId });
      setLinkFormFor(null);
      loadParents(studentId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnlinkParent = async (studentId, parentId) => {
    setError('');
    try {
      await api.delete(`/students/${studentId}/link-parent/${parentId}`);
      loadParents(studentId);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>{user.role === 'parent' ? 'My Children' : 'Students'}</h2>
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'Add Student'}</button>
        )}
      </div>
      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleCreate}>
          <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required>
            <option value="">Select a student account</option>
            {studentUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>
            ))}
          </select>
          <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">No class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="Roll number" value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
          <button type="submit">Create</button>
        </form>
      )}
      {isAdmin && studentUsers.length === 0 && (
        <p className="hint">
          No unassigned student accounts found. Create one first from the Users page (role: Student), then come back here to add them to a class.
        </p>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Class</th>
              <th>Roll #</th>
              <th>Attendance</th>
              {isAdmin && <th>Parents</th>}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} onMouseEnter={() => loadSummary(s.id)}>
                <td>{s.firstName} {s.lastName}</td>
                <td>{s.className || '—'}</td>
                <td>{s.rollNumber || '—'}</td>
                <td>{summary[s.id]?.attendancePercentage != null ? `${summary[s.id].attendancePercentage}%` : '—'}</td>
                {isAdmin && (
                  <td>
                    {(linkedParents[s.id] || []).map((p) => (
                      <span key={p.id} className="parent-chip">
                        {p.firstName} {p.lastName}
                        <button className="link-btn" onClick={() => handleUnlinkParent(s.id, p.id)} title="Unlink">×</button>
                      </span>
                    ))}
                    {linkFormFor === s.id ? (
                      <span className="inline-form" style={{ marginTop: 4 }}>
                        <select value={selectedParentId} onChange={(e) => setSelectedParentId(e.target.value)}>
                          <option value="">Select parent</option>
                          {parentUsers.map((p) => (
                            <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.email})</option>
                          ))}
                        </select>
                        <button className="link-btn" onClick={() => handleLinkParent(s.id)}>Link</button>
                        <button className="link-btn" onClick={() => setLinkFormFor(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="link-btn" onClick={() => openLinkForm(s.id)}>+ Link parent</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {students.length === 0 && (
              <tr><td colSpan={isAdmin ? 5 : 4} className="muted">No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
