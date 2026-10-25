import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import StatCard from '../components/StatCard';
import Icon from '../components/Icon';

const ROLE_BLURB = {
  admin: 'Here is how your school is doing today.',
  teacher: 'Your classes, assignments and announcements at a glance.',
  parent: "Keep up with your children's attendance, homework and school news.",
  student: 'Your attendance, assignments and the latest announcements.'
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

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
              { label: 'Teachers', value: overview.usersByRole.teacher, icon: 'users', tone: 'violet' },
              { label: 'Parents', value: overview.usersByRole.parent, icon: 'heart', tone: 'coral' },
              { label: 'Students', value: overview.usersByRole.student, icon: 'students', tone: 'teal' },
              { label: 'Classes', value: overview.classCount, icon: 'classes', tone: 'amber' }
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
              { label: 'My Classes', value: classes.classes.length, icon: 'classes', tone: 'violet' },
              { label: 'Assignments', value: assignments.assignments.length, icon: 'assignments', tone: 'teal' },
              { label: 'Alerts', value: ann.announcements.length, icon: 'bell', tone: 'coral' }
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
              { label: 'Linked Children', value: linked.students.length, icon: 'students', tone: 'violet' },
              { label: 'Attendance', value: attendancePct, icon: 'attendance', tone: 'amber' },
              { label: 'Alerts', value: ann.announcements.length, icon: 'bell', tone: 'coral' }
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
              { label: 'Attendance', value: attendancePct, icon: 'attendance', tone: 'amber' },
              { label: 'Assignments', value: assignments.assignments.length, icon: 'assignments', tone: 'teal' },
              { label: 'Alerts', value: ann.announcements.length, icon: 'bell', tone: 'coral' }
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
      <section className="hero">
        <div>
          <span className="hero-eyebrow"><Icon name="sparkle" size={14} /> {user.role} dashboard</span>
          <h2>{greeting()}, {user.firstName}</h2>
          <p>{ROLE_BLURB[user.role]}</p>
        </div>
        <span className="hero-art" aria-hidden="true"><Icon name="heart" size={64} /></span>
      </section>
      {error && <div className="alert error">{error}</div>}

      <div className="stat-grid">
        {stats
          ? stats.tiles.map((t) => <StatCard key={t.label} {...t} />)
          : [0, 1, 2].map((i) => <div key={i} className="stat-card skeleton" />)}
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Latest announcements</h3>
          <span className="muted">{announcements.length} recent</span>
        </div>
        {announcements.length === 0 && (
          <div className="empty-state"><Icon name="inbox" size={28} /><p>No announcements yet.</p></div>
        )}
        <ul className="activity-list">
          {announcements.map((a) => (
            <li key={a.id}>
              <span className="activity-dot"><Icon name="announcements" size={16} /></span>
              <div>
                <div className="activity-title">
                  <strong>{a.title}</strong>
                  <span className="tag">{a.className || 'School-wide'}</span>
                </div>
                <p>{a.body}</p>
                <span className="activity-meta">{new Date(a.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
