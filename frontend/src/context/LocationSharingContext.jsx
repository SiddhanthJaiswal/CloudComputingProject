import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { api } from '../api/client';

// Student-side location sharing. Runs app-wide (not per page) so sharing keeps
// going while the student moves around the app; it stops when they close the
// tab, press Stop, or sign out. Whether they had sharing on is remembered per
// device so it resumes next time - with the indicator visible in the top bar.
const LocationSharingContext = createContext(null);

const PREF_KEY = 'pp-share-location';
const MIN_INTERVAL_MS = 10 * 1000;   // never send more often than this
const MAX_INTERVAL_MS = 60 * 1000;   // send at least this often while sharing
const MIN_MOVE_METERS = 25;          // or sooner if the device moved this far

// Keyed by user so another student signing in on this device never inherits it.
function readPref(userId) {
  try { return localStorage.getItem(`${PREF_KEY}:${userId}`) === 'on'; } catch { return false; }
}
function writePref(userId, on) {
  try {
    const key = `${PREF_KEY}:${userId}`;
    on ? localStorage.setItem(key, 'on') : localStorage.removeItem(key);
  } catch { /* storage blocked */ }
}

function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function LocationSharingProvider({ children }) {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const userId = user?.id;
  // off | starting | on | denied | unavailable | error
  const [status, setStatus] = useState('off');
  const [position, setPosition] = useState(null);
  const [lastSentAt, setLastSentAt] = useState(null);
  const watchId = useRef(null);
  const lastSent = useRef(null);

  const clearWatch = () => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  };

  const send = useCallback(async (pos) => {
    const now = Date.now();
    const prev = lastSent.current;
    if (prev) {
      const elapsed = now - prev.at;
      const moved = distanceMeters(prev, pos);
      if (elapsed < MIN_INTERVAL_MS) return;
      if (elapsed < MAX_INTERVAL_MS && moved < MIN_MOVE_METERS) return;
    }
    lastSent.current = { ...pos, at: now };
    try {
      await api.put('/location/me', pos);
      setLastSentAt(new Date());
      setStatus('on');
    } catch {
      setStatus('error');
    }
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    clearWatch();
    lastSent.current = null;
    setStatus('starting');
    writePref(userId, true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        setPosition(pos);
        send(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          clearWatch();
          writePref(userId, false);
          setStatus('denied');
        } else {
          setStatus('error');
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    );
  }, [send, userId]);

  const stop = useCallback(async () => {
    clearWatch();
    writePref(userId, false);
    lastSent.current = null;
    setPosition(null);
    setStatus('off');
    try { await api.delete('/location/me'); } catch { /* signed out already */ }
  }, [userId]);

  // Resume on load if the student left sharing on; stop when they sign out.
  useEffect(() => {
    if (isStudent && readPref(userId)) start();
    if (!isStudent) {
      clearWatch();
      setStatus('off');
      setPosition(null);
    }
    return clearWatch;
  }, [isStudent, userId, start]);

  const value = { status, position, lastSentAt, start, stop, active: status === 'on' || status === 'starting' };
  return <LocationSharingContext.Provider value={value}>{children}</LocationSharingContext.Provider>;
}

export function useLocationSharing() {
  return useContext(LocationSharingContext);
}
