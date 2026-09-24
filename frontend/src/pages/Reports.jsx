import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export default function Reports() {
  const { user } = useAuth();

  if (user.role === 'admin' || user.role === 'teacher') return <ClassReports />;
  return <StudentReports />;
}

function ClassReports() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const c = await api.get('/classes');
        const visible = user.role === 'admin' ? c.classes : await filterOwnClasses(c.classes, user.id);
        setClasses(visible);
        const results = {};
        for (const cls of visible) {
          try {
            results[cls.id] = await api.get(`/reports/class/${cls.id}/summary`);
          } catch {
            // teacher without access to this class - skip
          }
        }
        setSummaries(results);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [user]);

  return (
    <div>
      <h2>Reports</h2>
      {error && <div className="alert error">{error}</div>}
      <div className="two-col">
        {classes.map((c) => {
          const s = summaries[c.id];
          if (!s) return null;
          return (
            <div className="card" key={c.id}>
              <h3>{c.name}</h3>
              <div className="stat-grid">
                <div className="stat-card"><div className="stat-value">{s.studentCount}</div><div className="stat-label">Students</div></div>
                <div className="stat-card"><div className="stat-value">{s.assignmentCount}</div><div className="stat-label">Assignments</div></div>
                <div className="stat-card"><div className="stat-value">{s.averageAttendancePercentage ?? '—'}%</div><div className="stat-label">Avg Attendance</div></div>
              </div>
            </div>
          );
        })}
        {classes.length === 0 && <p className="muted">No classes to report on.</p>}
      </div>
    </div>
  );
}

async function filterOwnClasses(classes, teacherId) {
  const result = await api.get(`/teachers/${teacherId}/classes`);
  const ids = new Set(result.classes.map((c) => c.id));
  return classes.filter((c) => ids.has(c.id));
}

function StudentReports() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const path = user.role === 'parent' ? `/parents/${user.id}/students` : '/students';
    api.get(path)
      .then((r) => {
        setStudents(r.students);
        if (r.students.length > 0) setSelected(String(r.students[0].id));
      })
      .catch((e) => setError(e.message));
  }, [user]);

  useEffect(() => {
    if (!selected) return;
    api.get(`/reports/student/${selected}`).then(setReport).catch((e) => setError(e.message));
  }, [selected]);

  return (
    <div>
      <h2>Reports</h2>
      {error && <div className="alert error">{error}</div>}

      {students.length > 1 && (
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
        </select>
      )}

      {report && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-value">{report.attendance.percentage ?? '—'}%</div><div className="stat-label">Attendance</div></div>
          <div className="stat-card"><div className="stat-value">{report.attendance.counts.present}</div><div className="stat-label">Days Present</div></div>
          <div className="stat-card"><div className="stat-value">{report.attendance.counts.absent}</div><div className="stat-label">Days Absent</div></div>
          <div className="stat-card"><div className="stat-value">{report.assignments.total}</div><div className="stat-label">Assignments</div></div>
        </div>
      )}
    </div>
  );
}
