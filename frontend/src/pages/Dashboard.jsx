import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import StatCard from '../components/StatCard';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const ann = await api.get('/announcements');
        if (cancelled) return;
        setAnnouncements(ann.announcements.slice(0, 5));

        if (user.role === 'admin') {
          const overview = await api.get('/admin/overview');
          if (cancelled) return;
          setStats({
            tiles: [
              { label: 'Teachers', value: overview.usersByRole.teacher },
              { label: 'Parents', value: overview.usersByRole.parent },
              { label: 'Students', value: overview.usersByRole.student },
              { label: 'Classes', value: overview.classCount }
            ]
          });
        } else if (user.role === 'teacher') {
          const [classes, assignments] = await Promise.all([
            api.get(`/teachers/${user.id}/classes`),
            api.get('/assignments')
          ]);
          if (cancelled) return;
          setStats({
            tiles: [
              { label: 'My Classes', value: classes.classes.length },
              { label: 'Assignments', value: assignments.assignments.length },
              { label: 'Alerts', value: ann.announcements.length }
            ]
          });
        } else if (user.role === 'parent') {
          const linked = await api.get(`/parents/${user.id}/students`);
          if (cancelled) return;
          let attendancePct = '—';
          if (linked.students.length > 0) {
            const summary = await api.get(`/attendance/summary/${linked.students[0].id}`);
            attendancePct = summary.attendancePercentage !== null ? `${summary.attendancePercentage}%` : '—';
          }
          setStats({
            tiles: [
              { label: 'Linked Children', value: linked.students.length },
              { label: 'Attendance', value: attendancePct },
              { label: 'Alerts', value: ann.announcements.length }
            ]
          });
        } else {
          const [assignments, own] = await Promise.all([
            api.get('/assignments'),
            api.get('/students')
          ]);
          if (cancelled) return;
          let attendancePct = '—';
          if (own.students.length > 0) {
            const summary = await api.get(`/attendance/summary/${own.students[0].id}`);
            attendancePct = summary.attendancePercentage !== null ? `${summary.attendancePercentage}%` : '—';
          }
          setStats({
            tiles: [
              { label: 'Attendance', value: attendancePct },
              { label: 'Assignments', value: assignments.assignments.length },
              { label: 'Alerts', value: ann.announcements.length }
            ]
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div>
      <h2>Welcome, {user.firstName}</h2>
      {error && <div className="alert error">{error}</div>}

      <div className="stat-grid">
        {(stats?.tiles || []).map((t) => (
          <StatCard key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      <div className="card">
        <h3>Recent activity / announcements</h3>
        {announcements.length === 0 && <p className="muted">No announcements yet.</p>}
        <ul className="activity-list">
          {announcements.map((a) => (
            <li key={a.id}>
              <strong>{a.title}</strong>
              <span className="muted"> — {a.className || 'School-wide'} — {new Date(a.createdAt).toLocaleDateString()}</span>
              <p>{a.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
