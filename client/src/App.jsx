import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import { Chart as ChartJS, CategoryScale, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { CloudSun, Leaf, Layers3, MapPinned, SlidersHorizontal } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const fallbackApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3000`;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || fallbackApiBaseUrl
});

const lineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false
  },
  animation: {
    duration: 900,
    easing: 'easeOutQuart'
  },
  plugins: {
    legend: {
      position: 'top',
      labels: {
        usePointStyle: true,
        boxWidth: 10,
        boxHeight: 10,
        padding: 14,
        color: '#334155',
        font: {
          family: 'Manrope',
          size: 12,
          weight: '600'
        }
      }
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.9)',
      titleColor: '#f8fafc',
      bodyColor: '#e2e8f0',
      padding: 10,
      cornerRadius: 10,
      titleFont: {
        family: 'Manrope',
        size: 12,
        weight: '700'
      },
      bodyFont: {
        family: 'Manrope',
        size: 12
      }
    }
  },
  scales: {
    x: {
      grid: {
        display: false
      },
      ticks: {
        color: '#475569',
        maxRotation: 0,
        autoSkip: true,
        font: {
          family: 'Manrope',
          size: 11,
          weight: '600'
        }
      }
    },
    y: {
      beginAtZero: false
      ,
      grace: '6%',
      grid: {
        color: 'rgba(148, 163, 184, 0.16)',
        drawBorder: false
      },
      ticks: {
        color: '#334155',
        font: {
          family: 'Manrope',
          size: 11,
          weight: '600'
        }
      }
    }
  }
};

const temperatureOptions = {
  ...lineOptions,
  scales: {
    y: {
      beginAtZero: false,
      grace: '8%'
    }
  }
};

function toLineData(label, items, color) {
  const hasSinglePoint = items.length <= 1;
  return {
    labels: items.map((item) => item.date),
    datasets: [
      {
        label,
        data: items.map((item) => item.value),
        borderColor: color,
        backgroundColor: `${color}44`,
        borderWidth: 2.3,
        tension: 0.35,
        pointRadius: hasSinglePoint ? 4 : 0,
        pointHoverRadius: 4,
        pointHitRadius: 12
      }
    ]
  };
}

function toTemperatureLineData(items) {
  return {
    labels: items.map((item) => item.date),
    datasets: [
      {
        label: 'Mean Temperature',
        data: items.map((item) => item.mean),
        borderColor: '#f87171',
        backgroundColor: '#f8717144',
        borderWidth: 2.3,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12
      },
      {
        label: 'Max Temperature',
        data: items.map((item) => item.max),
        borderColor: '#fbbf24',
        backgroundColor: '#fbbf2444',
        borderWidth: 2.3,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12
      },
      {
        label: 'Min Temperature',
        data: items.map((item) => item.min),
        borderColor: '#60a5fa',
        backgroundColor: '#60a5fa44',
        borderWidth: 2.3,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 12
      }
    ]
  };
}

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng);
    }
  });

  return null;
}

function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
          <Icon size={17} />
        </span>
        <div>
          <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">{title}</h2>
          {subtitle ? <p className="m-0 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
    </div>
  );
}

function MapLegend({ type, visParams }) {
  const fallbackMeta = {
    ndvi: { title: 'Vegetation Change (NDVI)', min: -0.5, max: 0.5 },
    urban: { title: 'Urban Expansion (NDBI)', min: -0.4, max: 0.4 },
    water: { title: 'Water Change (NDWI)', min: -0.5, max: 0.5 },
    heat: { title: 'Heat Island Change (C)', min: -8, max: 8 },
    'land-cover': { title: 'Land Cover Classes', min: 0, max: 4 },
    transition: { title: 'Land Cover Transition', min: 0, max: 44 }
  };

  const meta = fallbackMeta[type] || fallbackMeta.ndvi;
  const palette = Array.isArray(visParams?.palette) && visParams.palette.length > 0
    ? visParams.palette
    : ['2c7bb6', 'ffffbf', 'd7191c'];
  const minValue = Number.isFinite(visParams?.min) ? visParams.min : meta.min;
  const maxValue = Number.isFinite(visParams?.max) ? visParams.max : meta.max;
  const gradient = `linear-gradient(to right, ${palette.map((color) => `#${color}`).join(', ')})`;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="m-0 text-xs font-semibold text-slate-700">{meta.title}</p>
      <div className="mt-2 h-3 w-full rounded-full border border-slate-200" style={{ background: gradient }} />
      <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-600">
        <span>{minValue}</span>
        <span>{maxValue}</span>
      </div>
    </div>
  );
}

const landCoverLegend = {
  type: 'land-cover',
  visParams: {
    min: 0,
    max: 4,
    palette: ['2C7BB6', '1A9641', 'FDE725', 'D7191C', 'A6A6A6']
  }
};

function getPointDelta(series, key = 'value') {
  if (!Array.isArray(series) || series.length < 2) {
    return null;
  }

  const first = Number(series[0]?.[key]);
  const last = Number(series[series.length - 1]?.[key]);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }

  return { first, last, diff: last - first };
}

function getPercentChange(series, key = 'value') {
  const delta = getPointDelta(series, key);
  if (!delta) {
    return null;
  }

  const denominator = Math.abs(delta.first) < 1e-6 ? 1 : Math.abs(delta.first);
  return (delta.diff / denominator) * 100;
}

function App() {
  const [lat, setLat] = useState('10.8505');
  const [lng, setLng] = useState('76.2711');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [beforeYear, setBeforeYear] = useState('2019');
  const [afterYear, setAfterYear] = useState('2024');
  const [landChangeType, setLandChangeType] = useState('ndvi');
  const [tileOpacity, setTileOpacity] = useState(0.65);
  const [temperatureSeries, setTemperatureSeries] = useState([]);
  const [temperatureTrend, setTemperatureTrend] = useState(null);
  const [rainfallSeries, setRainfallSeries] = useState([]);
  const [ndviSeries, setNdviSeries] = useState([]);
  const [urbanSeries, setUrbanSeries] = useState([]);
  const [landMap, setLandMap] = useState(null);
  const [beforeYearMap, setBeforeYearMap] = useState(null);
  const [afterYearMap, setAfterYearMap] = useState(null);
  const [landCoverYear, setLandCoverYear] = useState('2020');
  const [landCoverScope, setLandCoverScope] = useState('kerala');
  const [selectedDistrict, setSelectedDistrict] = useState('Thiruvananthapuram');
  const [landCoverTile, setLandCoverTile] = useState(null);
  const [landCoverStats, setLandCoverStats] = useState(null);
  const [landCoverLoading, setLandCoverLoading] = useState(false);
  const [changeBeforeYear, setChangeBeforeYear] = useState('2019');
  const [changeAfterYear, setChangeAfterYear] = useState('2024');
  const [transitionTile, setTransitionTile] = useState(null);
  const [transitionStats, setTransitionStats] = useState(null);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [mapLayerMode, setMapLayerMode] = useState('change');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mapCenter = useMemo(() => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return [latitude, longitude];
    }
    return [10.8505, 76.2711];
  }, [lat, lng]);

  function handleMapPick(latlng) {
    setLat(latlng.lat.toFixed(6));
    setLng(latlng.lng.toFixed(6));
  }

  useEffect(() => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const before = Number(beforeYear);
    const after = Number(afterYear);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return undefined;
    }

    if (!Number.isInteger(before) || !Number.isInteger(after) || after <= before) {
      return undefined;
    }

    let cancelled = false;

    async function loadLandChangeMap() {
      try {
        const [diffResponse, beforeResponse, afterResponse] = await Promise.all([
          api.get('/land-change-map', {
            params: { lat, lng, beforeYear, afterYear, type: landChangeType }
          }),
          api.get('/land-year-map', {
            params: { lat, lng, year: beforeYear }
          }),
          api.get('/land-year-map', {
            params: { lat, lng, year: afterYear }
          })
        ]);
        if (!cancelled) {
          setLandMap(diffResponse.data);
          setBeforeYearMap(beforeResponse.data);
          setAfterYearMap(afterResponse.data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setLandMap(null);
          setBeforeYearMap(null);
          setAfterYearMap(null);
          setError(requestError.response?.data?.error?.message || requestError.message);
        }
      }
    }

    loadLandChangeMap();

    return () => {
      cancelled = true;
    };
  }, [lat, lng, beforeYear, afterYear, landChangeType]);

  async function handleLoadData(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const baseParams = { lat, lng, startDate, endDate };
      const [tempRes, rainRes, ndviRes, urbanRes] = await Promise.all([
        api.get('/temperature-trend', { params: baseParams }),
        api.get('/rainfall-trend', { params: baseParams }),
        api.get('/ndvi-timeseries', { params: baseParams }),
        api.get('/urban-change', { params: baseParams })
      ]);

      setTemperatureSeries(tempRes.data?.series || []);
      setTemperatureTrend(tempRes.data?.trend || null);
      setRainfallSeries(rainRes.data);
      setNdviSeries(ndviRes.data);
      setUrbanSeries(urbanRes.data);
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateLandCover(event) {
    event.preventDefault();
    setLandCoverLoading(true);
    setError('');

    try {
      const statsRequest =
        landCoverScope === 'district'
          ? api.get('/district-stats', { params: { year: landCoverYear, district: selectedDistrict } })
          : api.get('/land-cover-stats', { params: { year: landCoverYear } });
      const [tileResponse, statsResponse] = await Promise.all([
        api.get('/land-cover-static', { params: { year: landCoverYear } }),
        statsRequest
      ]);
      setLandCoverTile(tileResponse.data);
      setLandCoverStats(statsResponse.data);
      setMapLayerMode('cover');
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || requestError.message);
    } finally {
      setLandCoverLoading(false);
    }
  }

  async function handleAnalyzeLandCoverChange(event) {
    event.preventDefault();
    setTransitionLoading(true);
    setError('');

    try {
      const [tileResponse, statsResponse] = await Promise.all([
        api.get('/land-cover-change-static', {
          params: { beforeYear: changeBeforeYear, afterYear: changeAfterYear }
        }),
        api.get('/land-cover-transition-stats', {
          params: { beforeYear: changeBeforeYear, afterYear: changeAfterYear }
        })
      ]);
      setTransitionTile(tileResponse.data);
      setTransitionStats(statsResponse.data);
      setMapLayerMode('transition');
    } catch (requestError) {
      setError(requestError.response?.data?.error?.message || requestError.message);
    } finally {
      setTransitionLoading(false);
    }
  }

  const temperatureDelta = getPointDelta(temperatureSeries, 'mean');
  const ndviPercentChange = getPercentChange(ndviSeries);
  const urbanPercentChange = getPercentChange(urbanSeries);
  const slope = Number(temperatureTrend?.slope);
  const pValue = Number(temperatureTrend?.pValue);
  const hasTrendStats = Number.isFinite(slope) && Number.isFinite(pValue);
  const trendStrength = !hasTrendStats
    ? 'Insufficient data'
    : pValue < 0.05
      ? slope > 0
        ? 'Significant warming'
        : 'Significant cooling'
      : 'No significant trend';

  const summaryCards = [
    {
      title: 'Avg Temperature Change',
      value: temperatureDelta ? `${temperatureDelta.diff >= 0 ? '+' : ''}${temperatureDelta.diff.toFixed(2)} C` : '--',
      subtitle: 'First vs last month (mean)',
      tone:
        temperatureDelta == null
          ? 'bg-slate-50 text-slate-600 border-slate-200'
          : temperatureDelta.diff >= 0
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-sky-50 text-sky-700 border-sky-200'
    },
    {
      title: 'NDVI Change',
      value: ndviPercentChange != null ? `${ndviPercentChange >= 0 ? '+' : ''}${ndviPercentChange.toFixed(1)}%` : '--',
      subtitle: 'Vegetation signal change',
      tone:
        ndviPercentChange == null
          ? 'bg-slate-50 text-slate-600 border-slate-200'
          : ndviPercentChange >= 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
    },
    {
      title: 'Urban Growth',
      value: urbanPercentChange != null ? `${urbanPercentChange >= 0 ? '+' : ''}${urbanPercentChange.toFixed(1)}%` : '--',
      subtitle: 'Built-up index change',
      tone:
        urbanPercentChange == null
          ? 'bg-slate-50 text-slate-600 border-slate-200'
          : urbanPercentChange >= 0
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-cyan-50 text-cyan-700 border-cyan-200'
    },
    {
      title: 'Temperature Trend Strength',
      value: trendStrength,
      subtitle: hasTrendStats ? `Slope ${slope.toFixed(4)} C/month, p=${pValue.toFixed(4)}` : 'Slope and p-value unavailable',
      tone: !hasTrendStats
        ? 'bg-slate-50 text-slate-600 border-slate-200'
        : pValue < 0.05
          ? slope > 0
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-sky-50 text-sky-700 border-sky-200'
          : 'bg-slate-50 text-slate-600 border-slate-200'
    }
  ];
  const activeMapTileUrl =
    mapLayerMode === 'cover'
      ? landCoverTile?.tileUrl
      : mapLayerMode === 'transition'
        ? transitionTile?.tileUrl
        : landMap?.tileUrl;
  const activeLegend =
    mapLayerMode === 'cover'
      ? landCoverLegend
      : mapLayerMode === 'transition'
        ? {
            type: 'transition',
            visParams: {
              min: 0,
              max: 44,
              palette: ['440154', '472d7b', '3b528b', '2c728e', '21918c', '27ad81', '5cc863', 'aadc32', 'fde725']
            }
          }
        : { type: landChangeType, visParams: landMap?.visParams };
  const landCoverYears = Array.from({ length: 10 }, (_, index) => String(2015 + index));
  const keralaDistrictOptions = [
    'Thiruvananthapuram',
    'Kollam',
    'Pathanamthitta',
    'Alappuzha',
    'Kottayam',
    'Idukki',
    'Ernakulam',
    'Thrissur',
    'Palakkad',
    'Malappuram',
    'Kozhikode',
    'Wayanad',
    'Kannur',
    'Kasaragod'
  ];
  const landCoverAreaCards = [
    { key: 'water', label: 'Water', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
    { key: 'forest', label: 'Forest', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { key: 'agriculture', label: 'Agriculture', tone: 'bg-lime-50 text-lime-700 border-lime-200' },
    { key: 'urban', label: 'Urban', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
    { key: 'bare', label: 'Bare', tone: 'bg-slate-50 text-slate-700 border-slate-200' }
  ];
  const transitionRows = Object.entries(transitionStats || {}).sort(([, areaA], [, areaB]) => Number(areaB) - Number(areaA));

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-cyan-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl border border-white/70 bg-white/80 p-6 shadow-soft backdrop-blur">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Earth Intelligence Suite</p>
          <h1 className="m-0 mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">Modern Climate Analytics Dashboard</h1>
          <p className="m-0 mt-2 text-sm text-slate-600">Interactive climate and land-change analysis using Earth Engine datasets.</p>
        </header>

        <main className="grid gap-5 lg:grid-cols-12">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:col-span-12">
            {summaryCards.map((card) => (
              <article key={card.title} className={`rounded-xl border p-4 shadow-soft ${card.tone}`}>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em]">{card.title}</p>
                <p className="m-0 mt-2 text-2xl font-extrabold tracking-tight">{card.value}</p>
                <p className="m-0 mt-1 text-xs opacity-80">{card.subtitle}</p>
              </article>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-7">
            <SectionTitle icon={MapPinned} title="Map" subtitle="Click on map to update coordinates" />
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMapLayerMode('change')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mapLayerMode === 'change' ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-700'}`}
              >
                Change Layer
              </button>
              <button
                type="button"
                onClick={() => setMapLayerMode('cover')}
                disabled={!landCoverTile?.tileUrl}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mapLayerMode === 'cover' ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Land Cover Layer
              </button>
              <button
                type="button"
                onClick={() => setMapLayerMode('transition')}
                disabled={!transitionTile?.tileUrl}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mapLayerMode === 'transition' ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-700'} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Transition Layer
              </button>
            </div>
            <div className="h-[350px] overflow-hidden rounded-xl border border-slate-200">
              <MapContainer center={mapCenter} zoom={9} scrollWheelZoom className="h-full w-full">
                <MapClickHandler onPick={handleMapPick} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {activeMapTileUrl ? <TileLayer url={activeMapTileUrl} opacity={tileOpacity} /> : null}
                <Marker position={mapCenter}>
                  <Popup>
                    Lat: {lat}, Lng: {lng}
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <article className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                  Before {beforeYear}
                </div>
                <div className="h-[220px]">
                  <MapContainer center={mapCenter} zoom={9} scrollWheelZoom className="h-full w-full">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {beforeYearMap?.tileUrl ? <TileLayer url={beforeYearMap.tileUrl} opacity={0.85} /> : null}
                    <Marker position={mapCenter} />
                  </MapContainer>
                </div>
              </article>
              <article className="overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                  After {afterYear}
                </div>
                <div className="h-[220px]">
                  <MapContainer center={mapCenter} zoom={9} scrollWheelZoom className="h-full w-full">
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {afterYearMap?.tileUrl ? <TileLayer url={afterYearMap.tileUrl} opacity={0.85} /> : null}
                    <Marker position={mapCenter} />
                  </MapContainer>
                </div>
              </article>
            </div>
            {activeMapTileUrl ? (
              <a className="mt-3 inline-flex text-sm font-medium text-cyan-700 hover:text-cyan-900" href={activeMapTileUrl} target="_blank" rel="noreferrer">
                Open Active Tile URL
              </a>
            ) : null}
            <MapLegend type={activeLegend.type} visParams={activeLegend.visParams} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-5">
            <SectionTitle icon={SlidersHorizontal} title="Controls Panel" subtitle="Date range, years and map opacity" />
            <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={handleLoadData}>
              <label className="text-xs font-medium text-slate-600">
                Latitude
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring" value={lat} onChange={(event) => setLat(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Longitude
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring" value={lng} onChange={(event) => setLng(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Start Date
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-slate-600">
                End Date
                <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Land Change Layer
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring"
                  value={landChangeType}
                  onChange={(event) => setLandChangeType(event.target.value)}
                >
                  <option value="ndvi">Vegetation Change</option>
                  <option value="urban">Urban Expansion</option>
                  <option value="water">Water Change</option>
                  <option value="heat">Heat Island</option>
                </select>
              </label>

              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600">Before Year</label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    className="w-full accent-cyan-600"
                    type="range"
                    min="2015"
                    max="2024"
                    step="1"
                    value={beforeYear}
                    onChange={(event) => {
                      const nextBefore = Number(event.target.value);
                      const currentAfter = Number(afterYear);
                      if (nextBefore >= currentAfter) {
                        setAfterYear(String(nextBefore + 1));
                      }
                      setBeforeYear(String(nextBefore));
                    }}
                  />
                  <span className="w-10 text-right text-sm font-semibold text-slate-700">{beforeYear}</span>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600">After Year</label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    className="w-full accent-cyan-600"
                    type="range"
                    min="2016"
                    max="2025"
                    step="1"
                    value={afterYear}
                    onChange={(event) => {
                      const nextAfter = Number(event.target.value);
                      const currentBefore = Number(beforeYear);
                      if (nextAfter <= currentBefore) {
                        setBeforeYear(String(nextAfter - 1));
                      }
                      setAfterYear(String(nextAfter));
                    }}
                  />
                  <span className="w-10 text-right text-sm font-semibold text-slate-700">{afterYear}</span>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600">Land Overlay Opacity</label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    className="w-full accent-cyan-600"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={tileOpacity}
                    onChange={(event) => setTileOpacity(Number(event.target.value))}
                  />
                  <span className="w-10 text-right text-sm font-semibold text-slate-700">{tileOpacity.toFixed(2)}</span>
                </div>
              </div>

              <button
                className="sm:col-span-2 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-cyan-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Load Trends'}
              </button>
            </form>

            {error ? <p className="mt-3 text-sm font-medium text-rose-600">{error}</p> : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-12">
            <SectionTitle icon={Layers3} title="Land Cover Generator" subtitle="Generate classified map for a selected year" />
            <form onSubmit={handleGenerateLandCover} className="grid gap-3 md:grid-cols-[220px_220px_auto] md:items-end">
              <label className="text-xs font-medium text-slate-600">
                Year selector
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring"
                  value={landCoverYear}
                  onChange={(event) => setLandCoverYear(event.target.value)}
                >
                  {landCoverYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Area selector
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring"
                  value={landCoverScope}
                  onChange={(event) => setLandCoverScope(event.target.value)}
                >
                  <option value="kerala">Entire Kerala</option>
                  <option value="district">Individual districts</option>
                </select>
              </label>
              {landCoverScope === 'district' ? (
                <label className="text-xs font-medium text-slate-600 md:col-span-3">
                  District
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring md:max-w-sm"
                    value={selectedDistrict}
                    onChange={(event) => setSelectedDistrict(event.target.value)}
                  >
                    {keralaDistrictOptions.map((district) => (
                      <option key={district} value={district}>
                        {district}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="submit"
                disabled={landCoverLoading}
                className="rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-emerald-700 hover:to-cyan-700 disabled:cursor-not-allowed disabled:opacity-70 md:w-64"
              >
                {landCoverLoading ? 'Generating...' : 'Generate Land Cover'}
              </button>
            </form>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {landCoverAreaCards.map((card) => {
                const areaValue = Number(landCoverStats?.[card.key]);
                return (
                  <article key={card.key} className={`rounded-xl border p-3 ${card.tone}`}>
                    <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em]">{card.label}</p>
                    <p className="m-0 mt-1 text-xl font-extrabold">{Number.isFinite(areaValue) ? areaValue.toFixed(2) : '--'}</p>
                    <p className="m-0 text-xs opacity-80">km2</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-12">
            <SectionTitle icon={Layers3} title="Land Cover Change Analyzer" subtitle="Compare class transitions between two years" />
            <form onSubmit={handleAnalyzeLandCoverChange} className="grid gap-3 md:grid-cols-[220px_220px_auto] md:items-end">
              <label className="text-xs font-medium text-slate-600">
                Before Year
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring"
                  value={changeBeforeYear}
                  onChange={(event) => setChangeBeforeYear(event.target.value)}
                >
                  {landCoverYears.map((year) => (
                    <option key={`before-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                After Year
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring"
                  value={changeAfterYear}
                  onChange={(event) => setChangeAfterYear(event.target.value)}
                >
                  {landCoverYears.map((year) => (
                    <option key={`after-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={transitionLoading}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-cyan-700 disabled:cursor-not-allowed disabled:opacity-70 md:w-64"
              >
                {transitionLoading ? 'Analyzing...' : 'Analyze Change'}
              </button>
            </form>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Transition</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Area (km2)</th>
                  </tr>
                </thead>
                <tbody>
                  {transitionRows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-sm text-slate-500" colSpan={2}>
                        Run Analyze Change to view transition statistics.
                      </td>
                    </tr>
                  ) : (
                    transitionRows.map(([transitionKey, area]) => (
                      <tr key={transitionKey} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-700">{transitionKey}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{Number(area).toFixed(4)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-12">
            <SectionTitle icon={CloudSun} title="Climate Graphs" subtitle="Temperature and rainfall monthly signals" />
            <div className="grid gap-4 md:grid-cols-2">
              <article className="h-[300px] rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-sm font-semibold text-slate-700">Temperature Trend (C)</h3>
                <Line data={toTemperatureLineData(temperatureSeries)} options={temperatureOptions} />
              </article>
              <article className="h-[300px] rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-sm font-semibold text-slate-700">Rainfall Trend (mm)</h3>
                <Line data={toLineData('Rainfall', rainfallSeries, '#38bdf8')} options={lineOptions} />
              </article>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:col-span-12">
            <SectionTitle icon={Leaf} title="Land Change Graphs" subtitle="Vegetation and built-up dynamics" />
            <div className="grid gap-4 md:grid-cols-2">
              <article className="h-[300px] rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-sm font-semibold text-slate-700">NDVI Time Series</h3>
                <Line data={toLineData('NDVI', ndviSeries, '#4ade80')} options={lineOptions} />
              </article>
              <article className="h-[300px] rounded-xl border border-slate-200 p-3">
                <h3 className="m-0 mb-2 text-sm font-semibold text-slate-700">Urban Change (NDBI)</h3>
                <Line data={toLineData('NDBI', urbanSeries, '#c084fc')} options={lineOptions} />
              </article>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
