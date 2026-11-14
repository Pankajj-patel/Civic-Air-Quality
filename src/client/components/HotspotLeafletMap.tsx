import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import { HotspotSeverity } from '../../shared/types.ts';

export interface HotspotMapPoint {
  locationName: string;
  latitude: number;
  longitude: number;
  severity: HotspotSeverity;
  compositeScore: number;
  dominantPollutant: string;
  meanValue: number;
  unit: string;
}

const SEVERITY_COLORS: Record<HotspotSeverity, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  moderate: '#D97706',
  watch: '#0D9488',
};

interface HotspotLeafletMapProps {
  points: HotspotMapPoint[];
}

export const HotspotLeafletMap: React.FC<HotspotLeafletMapProps> = ({ points }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      center: [points[0].latitude, points[0].longitude],
      zoom: 12,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const pt of points) {
      const color = SEVERITY_COLORS[pt.severity] || '#0D9488';
      const marker = L.circleMarker([pt.latitude, pt.longitude], {
        radius: 10,
        fillColor: color,
        color: '#FFFFFF',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      }).addTo(map);

      marker.bindPopup(
        `<div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
          <strong>${pt.locationName}</strong><br/>
          Severity: ${pt.severity.toUpperCase()} (Score ${pt.compositeScore.toFixed(1)})<br/>
          Dominant: ${pt.dominantPollutant} (${pt.meanValue.toFixed(1)} ${pt.unit})
        </div>`,
      );
      bounds.extend([pt.latitude, pt.longitude]);
    }

    if (points.length > 1) {
      map.fitBounds(bounds, { padding: [36, 36] });
    }

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="h-80 bg-slate-50 border border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center p-6 text-center">
        <MapPin className="w-6 h-6 text-slate-400 mb-2" />
        <p className="text-sm font-medium text-slate-800">
          Geographic coordinates not yet available
        </p>
        <p className="mt-1 text-xs text-slate-500 max-w-md">
          Upload a dataset containing Latitude and Longitude columns to plot station markers and
          elevated concentration zones on the interactive map.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-80 w-full rounded-xl border border-slate-200 overflow-hidden z-0"
    />
  );
};
