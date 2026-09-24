import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function Assignments() {
  const { user } = useAuth();
  const canCreate = user.role === 'teacher' || user.role === 'admin';

  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({ classId: '', subjectId: '', title: '', description: '', dueDate: '' });

  const load = async () => {
    try {
      const [a, c] = await Promise.all([api.get('/assignments'), api.get('/classes')]);
      setAssignments(a.assignments);
      setClasses(c.classes);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!form.classId) { setSubjects([]); return; }
    api.get(`/subjects?classId=${form.classId}`).then((r) => setSubjects(r.subjects)).catch(() => setSubjects([]));
  }, [form.classId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/assignments', {
        classId: form.classId,
        subjectId: form.subjectId,
        title: form.title,
        description: form.description,
        dueDate: form.dueDate || null
      });
      setForm({ classId: '', subjectId: '', title: '', description: '', dueDate: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/assignments/${id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Assignments</h2>
        {canCreate && <button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Cancel' : 'New Assignment'}</button>}
      </div>
      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleCreate}>
          <select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, subjectId: '' })} required>
            <option value="">Select class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} required>
            <option value="">Select subject</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <button type="submit">Create</button>
        </form>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Title</th><th>Class</th><th>Subject</th><th>Due</th><th>Teacher</th>{canCreate && <th></th>}</tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>{a.className}</td>
                <td>{a.subjectName}</td>
                <td>{a.dueDate ? new Date(a.dueDate).toLocaleDateString() : '—'}</td>
                <td>{a.teacherName}</td>
                {canCreate && (
                  <td>{(user.role === 'admin' || a.teacherId === user.id) && <button className="link-btn" onClick={() => handleDelete(a.id)}>Delete</button>}</td>
                )}
              </tr>
            ))}
            {assignments.length === 0 && <tr><td colSpan={6} className="muted">No assignments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
