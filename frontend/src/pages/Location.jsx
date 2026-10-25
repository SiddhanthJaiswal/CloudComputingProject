import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocationSharing } from '../context/LocationSharingContext';
import { api } from '../api/client';
import LiveMap from '../components/LiveMap';
import Icon from '../components/Icon';

const TONES = ['violet', 'coral', 'teal', 'amber'];
const REFRESH_MS = 30 * 1000;

export default function Location() {
  const { user } = useAuth();
  return user.role === 'parent' ? <ChildLocations /> : <ShareLocation />;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function initials(c) {
  return `${c.firstName?.[0] || ''}${c.lastName?.[0] || ''}`.toUpperCase();
}

function ChildLocations() {
  const [children, setChildren] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [error, setError] = useState('');
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/location/children');
      setChildren(r.children);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 15000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [load]);

  const markers = useMemo(() => (children || [])
    .map((c, i) => ({ c, tone: TONES[i % TONES.length] }))
    .filter(({ c }) => c.location.hasLocation)
    .map(({ c, tone }) => ({
      id: c.studentId, lat: c.location.lat, lng: c.location.lng, accuracy: c.location.accuracy,
      initials: initials(c), label: `${c.firstName} ${c.lastName} - ${c.location.live ? 'live' : `last seen ${timeAgo(c.location.updatedAt)}`}`,
      tone, stale: !c.location.live
    })), [children]);

  return (
    <div>
      <div className="page-header">
        <h2>Child locations</h2>
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>
      {error && <div className="alert error">{error}</div>}

      {children && children.length === 0 && (
        <div className="card empty-state"><Icon name="students" size={28} /><p>No children are linked to your account yet.</p></div>
      )}

      {children && children.length > 0 && (
        <div className="location-layout">
          <div className="card location-map-card">
            <LiveMap markers={markers} focusId={focusId} onSelect={setFocusId} />
            {markers.length === 0 && <div className="map-overlay">None of your children have shared a location yet.</div>}
          </div>
          <div className="location-list">
            {children.map((c, i) => {
              const loc = c.location;
              const pill = loc.live ? ['status-present', 'Live'] : loc.hasLocation ? ['status-late', 'Last known'] : ['status-excused', 'No location yet'];
              return (
                <button
                  key={c.studentId}
                  className={`card child-loc${focusId === c.studentId ? ' focused' : ''}`}
                  onClick={() => loc.hasLocation && setFocusId(c.studentId)}
                  disabled={!loc.hasLocation}
                >
                  <span className={`map-marker tone-${TONES[i % TONES.length]}`}>{initials(c)}</span>
                  <span className="child-loc-text">
                    <strong>{c.firstName} {c.lastName}</strong>
                    <small>{c.className || 'No class'}</small>
                  </span>
                  <span className="child-loc-status">
                    <span className={`status-pill ${pill[0]}`}>{pill[1]}</span>
                    <small>{loc.hasLocation ? `Updated ${timeAgo(loc.updatedAt)}` : 'Never shared'}</small>
                  </span>
                </button>
              );
            })}
            <p className="hint location-note">
              <Icon name="shield" size={14} /> Each child&apos;s location updates from their own device whenever they have ParentPulse
              open, so you see where they were last, with the time. <strong>Live</strong> means they have it open right now.
              Only linked parents can see this. Refreshes every 30 seconds.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT = {
  off: 'Location updates are off. Your parents can still see the last location you shared.',
  starting: 'Waiting for your device to report its location...',
  on: 'Your location updates while ParentPulse is open. Your parents see where you were last seen.',
  denied: 'Location permission was blocked. Allow location for this site in your browser settings, then try again.',
  unavailable: 'This browser does not support location sharing.',
  error: 'Could not get or send your location. It will keep retrying while sharing is on.'
};

function ShareLocation() {
  const { status, position, lastSentAt, start, stop, active } = useLocationSharing();
  const markers = useMemo(() => (position ? [{ id: 'me', ...position, initials: 'ME', label: 'You', tone: 'teal' }] : []), [position]);

  return (
    <div>
      <h2>Location sharing</h2>
      <div className="two-col">
        <div className="card share-card">
          <span className={`share-icon${active ? ' on' : ''}`}><Icon name="location" size={26} /></span>
          <h3>{active ? 'Sharing your location' : 'Share your location with your parents'}</h3>
          <p className={status === 'denied' || status === 'error' ? 'share-status warn' : 'share-status'}>{STATUS_TEXT[status]}</p>
          {lastSentAt && active && <p className="muted">Last sent {lastSentAt.toLocaleTimeString()}</p>}
          {active
            ? <button className="btn-ghost" onClick={stop}>Stop updates</button>
            : <button className="btn-primary" onClick={start}>Start sharing</button>}
          <ul className="share-facts">
            <li>Only your linked parents can see it. Teachers and other students cannot.</li>
            <li>It updates only while ParentPulse is open on this device.</li>
            <li>When you close the app or stop, your parents keep seeing your last shared location and when it was taken.</li>
          </ul>
        </div>
        <div className="card location-map-card">
          <LiveMap markers={markers} height={380} />
          {!position && <div className="map-overlay">Your position will appear here once sharing starts.</div>}
        </div>
      </div>
    </div>
  );
}
