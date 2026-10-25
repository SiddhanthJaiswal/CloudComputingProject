import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Thin Leaflet wrapper. markers: [{ id, lat, lng, accuracy, initials, label, tone }]
// Markers are HTML (initials avatars) rather than Leaflet's default image pins.
export default function LiveMap({ markers, focusId, onSelect, height = 440 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fitted = useRef(false);

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([12.9692, 79.1559], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    layer.current.clearLayers();
    for (const m of markers) {
      if (m.accuracy) {
        L.circle([m.lat, m.lng], {
          radius: m.accuracy, weight: 1, color: '#6a5ae6', fillColor: '#6a5ae6', fillOpacity: 0.12, interactive: false
        }).addTo(layer.current);
      }
      const icon = L.divIcon({
        className: '',
        html: `<span class="map-marker tone-${m.tone || 'violet'}${m.id === focusId ? ' focused' : ''}">${escapeHtml(m.initials)}</span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });
      L.marker([m.lat, m.lng], { icon, title: m.label, keyboard: true })
        .on('click', () => onSelect?.(m.id))
        .addTo(layer.current);
    }
    if (!fitted.current && markers.length > 0) {
      fitted.current = true;
      if (markers.length === 1) map.current.setView([markers[0].lat, markers[0].lng], 15);
      else map.current.fitBounds(L.latLngBounds(markers.map((m) => [m.lat, m.lng])), { padding: [40, 40], maxZoom: 15 });
    }
  }, [markers, focusId, onSelect]);

  useEffect(() => {
    const m = markers.find((x) => x.id === focusId);
    if (m && map.current) map.current.flyTo([m.lat, m.lng], Math.max(map.current.getZoom(), 15), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  return <div ref={el} className="live-map" style={{ height }} />;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
