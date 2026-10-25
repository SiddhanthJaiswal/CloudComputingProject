import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Icon from './Icon';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
const WARN_BEFORE_MS = 60 * 1000;
const KEEPALIVE_EVERY_MS = 4 * 60 * 1000;
// Shared across tabs, so activity in one tab keeps the others signed in too.
const LAST_ACTIVITY_KEY = 'pp-last-activity';

function readLastActivity(fallback) {
  try { return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || fallback; } catch { return fallback; }
}
function writeLastActivity(ts) {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(ts)); } catch { /* storage blocked */ }
}

// Signs the user out after a period of inactivity (matching the server's idle
// timeout), with a one-minute warning; while the user is active it pings the
// server so the sliding session cookie keeps being renewed.
export default function SessionTimeout() {
  const { session, logout } = useAuth();
  const idleMs = (session?.idleMinutes || 15) * 60 * 1000;
  const [secondsLeft, setSecondsLeft] = useState(null);
  const lastActivity = useRef(Date.now());
  const lastKeepalive = useRef(Date.now());

  const keepAlive = useCallback(() => {
    lastKeepalive.current = Date.now();
    api.post('/auth/refresh').catch(() => { /* a 401 is handled globally */ });
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    writeLastActivity(lastActivity.current);
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastWrite > 5000) { lastWrite = now; writeLastActivity(now); }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      const last = Math.max(lastActivity.current, readLastActivity(lastActivity.current));
      const remaining = idleMs - (now - last);

      if (remaining <= 0) {
        clearInterval(tick);
        logout('You were signed out after a period of inactivity.');
        return;
      }
      if (remaining <= WARN_BEFORE_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
        return;
      }
      setSecondsLeft(null);
      if (last > lastKeepalive.current && now - lastKeepalive.current > KEEPALIVE_EVERY_MS) keepAlive();
    }, 1000);
    return () => clearInterval(tick);
  }, [idleMs, logout, keepAlive]);

  if (secondsLeft === null) return null;

  const stay = () => {
    lastActivity.current = Date.now();
    writeLastActivity(lastActivity.current);
    keepAlive();
    setSecondsLeft(null);
  };

  return (
    <div className="modal-scrim" role="alertdialog" aria-modal="true" aria-labelledby="timeout-title">
      <div className="modal">
        <span className="modal-icon"><Icon name="shield" size={22} /></span>
        <h3 id="timeout-title">Are you still there?</h3>
        <p>For your security, you will be signed out in <strong>{secondsLeft}s</strong> due to inactivity.</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => logout('You signed out.')}>Sign out</button>
          <button className="btn-primary" onClick={stay} autoFocus>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
