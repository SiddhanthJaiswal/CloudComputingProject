import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_BY_ROLE = {
  admin: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/users', label: 'Users' },
    { to: '/classes', label: 'Classes' },
    { to: '/students', label: 'Students' },
    { to: '/assignments', label: 'Assignments' },
    { to: '/attendance', label: 'Attendance' },
    { to: '/announcements', label: 'Announcements' },
    { to: '/reports', label: 'Reports' },
    { to: '/profile', label: 'Profile' }
  ],
  teacher: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/students', label: 'Students' },
    { to: '/assignments', label: 'Assignments' },
    { to: '/attendance', label: 'Attendance' },
    { to: '/announcements', label: 'Announcements' },
    { to: '/reports', label: 'Reports' },
    { to: '/profile', label: 'Profile' }
  ],
  parent: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/students', label: 'My Children' },
    { to: '/assignments', label: 'Assignments' },
    { to: '/attendance', label: 'Attendance' },
    { to: '/announcements', label: 'Announcements' },
    { to: '/reports', label: 'Reports' },
    { to: '/profile', label: 'Profile' }
  ],
  student: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/assignments', label: 'Assignments' },
    { to: '/attendance', label: 'Attendance' },
    { to: '/announcements', label: 'Announcements' },
    { to: '/reports', label: 'Reports' },
    { to: '/profile', label: 'Profile' }
  ]
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV_BY_ROLE[user?.role] || [];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">ParentPulse</div>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="logout-btn" onClick={handleLogout}>Sign out</button>
      </aside>
      <main className="content">
        <header className="topbar">
          <span className="welcome">Welcome back, {user?.firstName}</span>
          <span className="topbar-user">
            <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
            <span className="avatar" title={`${user?.firstName} ${user?.lastName}`}>
              {initials(user)}
            </span>
          </span>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

function initials(user) {
  if (!user) return '';
  return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
}
