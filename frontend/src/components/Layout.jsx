import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import SessionTimeout from './SessionTimeout';
import { useLocationSharing } from '../context/LocationSharingContext';

const NAV_BY_ROLE = {
  admin: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/users', label: 'Users', icon: 'users' },
    { to: '/classes', label: 'Classes', icon: 'classes' },
    { to: '/students', label: 'Students', icon: 'students' },
    { to: '/assignments', label: 'Assignments', icon: 'assignments' },
    { to: '/attendance', label: 'Attendance', icon: 'attendance' },
    { to: '/announcements', label: 'Announcements', icon: 'announcements' },
    { to: '/reports', label: 'Reports', icon: 'reports' },
    { to: '/profile', label: 'Profile', icon: 'profile' }
  ],
  teacher: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/students', label: 'Students', icon: 'students' },
    { to: '/assignments', label: 'Assignments', icon: 'assignments' },
    { to: '/attendance', label: 'Attendance', icon: 'attendance' },
    { to: '/announcements', label: 'Announcements', icon: 'announcements' },
    { to: '/reports', label: 'Reports', icon: 'reports' },
    { to: '/profile', label: 'Profile', icon: 'profile' }
  ],
  parent: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/students', label: 'My Children', icon: 'students' },
    { to: '/location', label: 'Location', icon: 'location' },
    { to: '/assignments', label: 'Assignments', icon: 'assignments' },
    { to: '/attendance', label: 'Attendance', icon: 'attendance' },
    { to: '/announcements', label: 'Announcements', icon: 'announcements' },
    { to: '/reports', label: 'Reports', icon: 'reports' },
    { to: '/profile', label: 'Profile', icon: 'profile' }
  ],
  student: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/assignments', label: 'Assignments', icon: 'assignments' },
    { to: '/attendance', label: 'Attendance', icon: 'attendance' },
    { to: '/announcements', label: 'Announcements', icon: 'announcements' },
    { to: '/reports', label: 'Reports', icon: 'reports' },
    { to: '/location', label: 'Location sharing', icon: 'location' },
    { to: '/profile', label: 'Profile', icon: 'profile' }
  ]
};

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('pp-theme') || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    try { theme ? localStorage.setItem('pp-theme', theme) : localStorage.removeItem('pp-theme'); } catch { /* storage blocked */ }
  }, [theme]);
  const isDark = theme ? theme === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return [isDark, () => setTheme(isDark ? 'light' : 'dark')];
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, toggleTheme] = useTheme();
  const sharing = useLocationSharing();
  const nav = NAV_BY_ROLE[user?.role] || [];
  const current = nav.find((item) => location.pathname.startsWith(item.to));

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const handleLogout = async () => {
    await logout('You signed out.');
    navigate('/login');
  };

  return (
    <div className={`app-shell${menuOpen ? ' menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Icon name="heart" size={18} /></span>
          <span>ParentPulse</span>
          <button className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <div className="nav-section-label">Menu</div>
        <nav>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials(user)}</span>
          <span className="sidebar-user-text">
            <strong>{user?.firstName} {user?.lastName}</strong>
            <small>{user?.email}</small>
          </span>
          <button className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />
      <main className="content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <div>
              <div className="topbar-title">{current?.label || 'ParentPulse'}</div>
              <div className="topbar-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            </div>
          </div>
          <div className="topbar-user">
            {sharing?.active && (
              <NavLink to="/location" className="sharing-indicator" title="Your location is being shared with your parents">
                <span className="pulse-dot" /> Sharing location
              </NavLink>
            )}
            <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
              <Icon name={isDark ? 'sun' : 'moon'} />
            </button>
            <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
            <span className="avatar" title={`${user?.firstName} ${user?.lastName}`}>
              {initials(user)}
            </span>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
      <SessionTimeout />
    </div>
  );
}

function initials(user) {
  if (!user) return '';
  return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
}
