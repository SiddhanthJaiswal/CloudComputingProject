import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const STATUS_OPTIONS = ['present', 'absent', 'late', 'excused'];

export default function Attendance() {
  const { user } = useAuth();
  const canMark = user.role === 'teacher' || user.role === 'admin';

  if (canMark) return <MarkAttendance />;
  return <ViewAttendance />;
}

function MarkAttendance() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [students, setStudents] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/classes').then((r) => setClasses(r.classes)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setMessage('');
    if (!classId) { setStudents([]); return; }
    api.get(`/students?classId=${classId}`)
      .then((r) => {
        setStudents(r.students);
        setStatuses(Object.fromEntries(r.students.map((s) => [s.id, 'present'])));
      })
      .catch((e) => setError(e.message));
  }, [classId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const records = students.map((s) => ({ studentId: s.id, status: statuses[s.id] || 'present' }));
      await api.post('/attendance', { classId, date, records });
      setMessage('Attendance saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h2>Mark Attendance</h2>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="card">
        <div className="inline-form">
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Select class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {students.length > 0 && (
          <form onSubmit={submit}>
            <table className="data-table">
              <thead><tr><th>Student</th><th>Status</th></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.firstName} {s.lastName}</td>
                    <td>
                      <select value={statuses[s.id]} onChange={(e) => setStatuses({ ...statuses, [s.id]: e.target.value })}>
                        {STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="submit">Save Attendance</button>
          </form>
        )}
      </div>
    </div>
  );
}

function ViewAttendance() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState('');
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const path = user.role === 'parent' ? `/parents/${user.id}/students` : '/students';
    api.get(path)
      .then((r) => {
        const list = r.students;
        setStudents(list);
        if (list.length > 0) setSelected(String(list[0].id));
      })
      .catch((e) => setError(e.message));
  }, [user]);

  useEffect(() => {
    if (!selected) return;
    Promise.all([
      api.get(`/attendance?studentId=${selected}`),
      api.get(`/attendance/summary/${selected}`)
    ])
      .then(([r, s]) => {
        setRecords(r.attendance);
        setSummary(s);
      })
      .catch((e) => setError(e.message));
  }, [selected]);

  return (
    <div>
      <h2>Attendance</h2>
      {error && <div className="alert error">{error}</div>}

      {students.length > 1 && (
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>
      )}

      {summary && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-value">{summary.attendancePercentage ?? '—'}%</div><div className="stat-label">Attendance</div></div>
          <div className="stat-card"><div className="stat-value">{summary.counts.present}</div><div className="stat-label">Present</div></div>
          <div className="stat-card"><div className="stat-value">{summary.counts.absent}</div><div className="stat-label">Absent</div></div>
          <div className="stat-card"><div className="stat-value">{summary.counts.late}</div><div className="stat-label">Late</div></div>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}><td>{new Date(r.date).toLocaleDateString()}</td><td className={`status-${r.status}`}>{r.status}</td></tr>
            ))}
            {records.length === 0 && <tr><td colSpan={2} className="muted">No attendance records yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
