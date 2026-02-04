
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  subMonths, 
  isSameMonth, 
  isSameDay,
  parse,
  startOfWeek,
  endOfWeek,
  addDays,
  differenceInDays,
  isAfter,
  isBefore
} from 'date-fns';
import { 
  ChevronLeft, 
  ChevronRight, 
  Waves, 
  Search, 
  Anchor, 
  Info,
  Calendar as CalendarIcon,
  Navigation,
  Loader2,
  AlertCircle,
  List,
  Clock,
  Star,
  StarOff,
  X,
  Bell,
  BellRing,
  Settings,
  CheckCircle2
} from 'lucide-react';
import { fetchTidePredictions } from './services/noaaService';
import { findStationId } from './services/geminiService';
import { DailyTideData, TideEvent } from './types';

interface SavedStation {
  id: string;
  name: string;
}

interface NotificationSettings {
  enabled: boolean;
  leadDays: number; // How many days before to notify
}

const App: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [station, setStation] = useState<SavedStation>({ id: '9414290', name: 'San Francisco, CA' });
  const [threshold, setThreshold] = useState(6.0);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [dailyData, setDailyData] = useState<DailyTideData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('list');
  const [showSettings, setShowSettings] = useState(false);
  
  // Notification State
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(() => {
    const saved = localStorage.getItem('tidewatch_notif_settings');
    return saved ? JSON.parse(saved) : { enabled: false, leadDays: 1 };
  });

  // Favorites State
  const [favorites, setFavorites] = useState<SavedStation[]>(() => {
    const saved = localStorage.getItem('tidewatch_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  // Persist settings
  useEffect(() => {
    localStorage.setItem('tidewatch_favorites', JSON.stringify(favorites));
    localStorage.setItem('tidewatch_notif_settings', JSON.stringify(notifSettings));
  }, [favorites, notifSettings]);

  // Request Notification Permission
  const requestNotifPermission = async () => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotifSettings(prev => ({ ...prev, enabled: true }));
    } else {
      setNotifSettings(prev => ({ ...prev, enabled: false }));
      alert('Notification permissions were denied. Please enable them in your browser settings.');
    }
  };

  // Logic to process notifications for upcoming tides
  const checkUpcomingTidesForAlerts = useCallback(async (data: DailyTideData[]) => {
    if (!notifSettings.enabled || Notification.permission !== 'granted') return;

    const today = new Date();
    const upcomingCrossings = data.filter(d => 
      d.meetsThreshold && 
      isAfter(d.date, today) && 
      differenceInDays(d.date, today) <= notifSettings.leadDays + 7
    );

    for (const day of upcomingCrossings) {
      const diff = differenceInDays(day.date, today);
      const isLeadTimeMet = diff <= notifSettings.leadDays;

      if (isLeadTimeMet) {
        // Find the specific peak
        const maxEvent = day.events.find(e => e.type === 'H' && e.height >= threshold);
        if (maxEvent) {
          const alertKey = `alert_${station.id}_${format(day.date, 'yyyyMMdd')}`;
          if (!localStorage.getItem(alertKey)) {
            // Send to service worker for display
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                payload: {
                  title: `🌊 Tide Alert: ${station.name}`,
                  body: `High tide will reach ${maxEvent.height.toFixed(2)}ft on ${format(day.date, 'EEEE, MMM d')} at ${format(maxEvent.time, 'h:mm a')}.`,
                  icon: 'https://img.icons8.com/fluency/96/000000/waves.png'
                }
              });
              localStorage.setItem(alertKey, 'sent');
            }
          }
        }
      }
    }
  }, [notifSettings, station, threshold]);

  const loadTideData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const beginDate = format(startOfMonth(currentDate), 'yyyyMMdd');
      const endDate = format(endOfMonth(currentDate), 'yyyyMMdd');
      
      const hilo = await fetchTidePredictions(station.id, beginDate, endDate, 'predictions', 'MLLW', 'hilo');
      
      const days = eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      });

      const processed: DailyTideData[] = days.map(day => {
        const events: TideEvent[] = hilo
          .filter(p => isSameDay(parse(p.t, 'yyyy-MM-dd HH:mm', new Date()), day))
          .map(p => ({
            time: parse(p.t, 'yyyy-MM-dd HH:mm', new Date()),
            height: parseFloat(p.v),
            isPeak: true,
            type: p.type as 'H' | 'L'
          }));

        const heights = events.filter(e => e.type === 'H').map(e => e.height);
        const maxHeight = heights.length ? Math.max(...heights) : 0;
        
        return {
          date: day,
          events,
          maxHeight,
          minHeight: events.length ? Math.min(...events.map(e => e.height)) : 0,
          meetsThreshold: maxHeight >= threshold
        };
      });

      setDailyData(processed);
      checkUpcomingTidesForAlerts(processed);
      
    } catch (err) {
      setError('Could not load tide data for this station. Please try another.');
    } finally {
      setLoading(false);
    }
  }, [currentDate, station, threshold, checkUpcomingTidesForAlerts]);

  useEffect(() => {
    loadTideData();
  }, [loadTideData]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    const result = await findStationId(searchQuery);
    if (result && result.stationId) {
      setStation({ id: result.stationId, name: result.stationName });
      setSearchQuery('');
    } else {
      setError('Station not found. Try a coastal city or zip code.');
    }
    setLoading(false);
  };

  const toggleFavorite = () => {
    setFavorites(prev => {
      const isFav = prev.some(f => f.id === station.id);
      if (isFav) {
        return prev.filter(f => f.id !== station.id);
      } else {
        return [...prev, station];
      }
    });
  };

  const isCurrentFavorite = favorites.some(f => f.id === station.id);

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarStart = startOfWeek(startOfMonth(currentDate));
  const calendarEnd = endOfWeek(endOfMonth(currentDate));
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const thresholdEvents = useMemo(() => {
    return dailyData
      .filter(d => d.meetsThreshold)
      .flatMap(d => d.events.filter(e => e.type === 'H' && e.height >= threshold));
  }, [dailyData, threshold]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 pb-32">
      {/* Header & Search */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-4xl font-extrabold text-blue-900 flex items-center gap-2">
            <Waves className="text-blue-500 w-10 h-10" />
            TideWatch
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-slate-600 font-semibold">{station.name}</p>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={toggleFavorite}
                className={`p-1.5 rounded-full transition-all ${isCurrentFavorite ? 'text-yellow-500 bg-yellow-50' : 'text-slate-300 hover:text-slate-400 bg-slate-100'}`}
                title={isCurrentFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star size={18} fill={isCurrentFavorite ? "currentColor" : "none"} />
              </button>
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-1.5 rounded-full transition-all relative ${notifSettings.enabled ? 'text-blue-500 bg-blue-50' : 'text-slate-300 hover:text-slate-400 bg-slate-100'}`}
                title="Notification Settings"
              >
                {notifSettings.enabled ? <BellRing size={18} /> : <Bell size={18} />}
                {notifSettings.enabled && <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full border border-white"></span>}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form onSubmit={handleSearch} className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search station..."
              className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-blue-400 focus:outline-none transition-all bg-white shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="absolute left-3 top-3.5 text-slate-400 w-5 h-5" />
          </form>
          
          <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-sm shrink-0">
            <span className="text-sm font-semibold text-slate-500 mr-2">Target:</span>
            <input
              type="number"
              step="0.1"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-16 bg-blue-50 text-blue-700 font-bold rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="ml-1 text-sm text-slate-500">ft</span>
          </div>
        </div>
      </header>

      {/* Notification Settings Panel */}
      {showSettings && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 mb-8 shadow-xl animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-500" />
              Notification Center
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-700">Push Notifications</span>
                <button 
                  onClick={notifSettings.enabled ? () => setNotifSettings(s => ({...s, enabled: false})) : requestNotifPermission}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifSettings.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-xs text-slate-500">Get alerted even when the app is closed. Requires browser permission.</p>
            </div>

            <div className={`p-4 rounded-2xl border transition-opacity ${notifSettings.enabled ? 'bg-blue-50/50 border-blue-100 opacity-100' : 'bg-slate-50 border-slate-100 opacity-50 pointer-events-none'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-700">Alert Lead Time</span>
                <select 
                  value={notifSettings.leadDays}
                  onChange={(e) => setNotifSettings(s => ({...s, leadDays: parseInt(e.target.value)}))}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-blue-600"
                >
                  <option value="0">Same Day</option>
                  <option value="1">1 Day Before</option>
                  <option value="2">2 Days Before</option>
                  <option value="3">3 Days Before</option>
                  <option value="7">1 Week Before</option>
                </select>
              </div>
              <p className="text-xs text-slate-500">How many days in advance should we notify you of target crossings?</p>
            </div>
          </div>
          
          {notifSettings.enabled && (
            <div className="mt-4 flex items-center gap-2 text-green-600 text-xs font-bold bg-green-50 p-2 rounded-xl border border-green-100">
              <CheckCircle2 size={14} />
              Notifications Active for {station.name}
            </div>
          )}
        </div>
      )}

      {/* Favorites List */}
      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8 items-center">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mr-2">Favorites:</span>
          {favorites.map(fav => (
            <div key={fav.id} className="group relative">
              <button
                onClick={() => setStation(fav)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 border shadow-sm ${
                  station.id === fav.id 
                  ? 'bg-blue-600 border-blue-600 text-white' 
                  : 'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                <Anchor size={14} className={station.id === fav.id ? 'text-blue-200' : 'text-slate-400'} />
                {fav.name}
              </button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setFavorites(prev => prev.filter(f => f.id !== fav.id));
                }}
                className="absolute -top-1 -right-1 bg-white text-slate-400 rounded-full border border-slate-200 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:text-red-500"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-r-2xl mb-8 flex gap-3 items-center">
          <AlertCircle className="text-red-500 shrink-0" />
          <p className="text-red-800 font-medium">{error}</p>
        </div>
      )}

      {/* View Toggle & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4 px-2">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-blue-500" />
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"><ChevronLeft /></button>
            <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"><ChevronRight /></button>
          </div>
        </div>

        <div className="inline-flex p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <CalendarIcon size={16} /> Calendar
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <List size={16} /> List Target
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden relative min-h-[500px]">
        {loading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
              <p className="text-blue-600 font-bold animate-pulse">Calculating Tides...</p>
            </div>
          </div>
        )}

        {viewMode === 'calendar' ? (
          <div className="animate-in fade-in duration-300">
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
              {weekDays.map(day => <div key={day} className="py-4 text-center text-sm font-bold text-slate-400 uppercase tracking-widest">{day}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {calendarDays.map((day) => {
                const data = dailyData.find(d => isSameDay(d.date, day));
                const isActiveMonth = isSameMonth(day, currentDate);
                const isTargetDay = data?.meetsThreshold;
                return (
                  <div key={day.toISOString()} className={`min-h-[140px] p-2 border-r border-b border-slate-100 relative transition-all group hover:bg-blue-50/30 ${!isActiveMonth ? 'bg-slate-50/20 opacity-30' : ''}`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className={`text-lg font-bold w-8 h-8 flex items-center justify-center rounded-full ${isSameDay(day, new Date()) ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{format(day, 'd')}</span>
                      {isTargetDay && isActiveMonth && (
                        <div className="bg-blue-500 text-white px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter flex items-center gap-1 shadow-sm animate-pulse"><Anchor size={10} /> {threshold}ft+</div>
                      )}
                    </div>
                    {isActiveMonth && data && (
                      <div className="space-y-1 overflow-hidden">
                        {data.events.slice(0, 3).map((event, idx) => (
                          <div key={idx} className={`text-[11px] font-medium px-2 py-1 rounded-lg border flex justify-between items-center ${event.type === 'H' ? (event.height >= threshold ? 'bg-blue-100 border-blue-200 text-blue-800' : 'bg-slate-100 border-slate-200 text-slate-600') : 'bg-indigo-50 border-indigo-100 text-indigo-500 opacity-60'}`}>
                            <span className="flex items-center gap-1">{event.type === 'H' ? 'High' : 'Low'}</span>
                            <span className="font-bold">{event.height.toFixed(1)}'</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-6 animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-800">Days Meeting {threshold}ft+ Target</h3>
              <div className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{thresholdEvents.length} occurrences found</div>
            </div>
            {thresholdEvents.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {thresholdEvents.map((event, idx) => (
                  <div key={idx} className="flex flex-col p-4 bg-white border border-slate-200 rounded-2xl hover:border-blue-400 hover:shadow-md transition-all group shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-blue-500 uppercase tracking-wider">{format(event.time, 'EEEE')}</span>
                        <span className="text-lg font-extrabold text-slate-800">{format(event.time, 'MMM d, yyyy')}</span>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors"><Waves size={24} /></div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl mt-auto border border-slate-100">
                      <div className="flex items-center gap-2"><Clock size={16} className="text-slate-400" /><span className="text-sm font-bold text-slate-700">{format(event.time, 'h:mm a')}</span></div>
                      <div className="flex items-center gap-1"><span className="text-2xl font-black text-blue-600">{event.height.toFixed(2)}</span><span className="text-xs font-bold text-slate-400 uppercase">FT</span></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-20 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300"><Anchor size={40} /></div>
                <h4 className="text-lg font-bold text-slate-700">No matching tides this month</h4>
                <p className="text-slate-500 max-w-xs mx-auto">None of the high tide peaks are predicted to reach {threshold}ft in {format(currentDate, 'MMMM')}. Try lowering your target.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Action Button for Location */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-20">
        <button 
          onClick={() => {
            if ("geolocation" in navigator) {
              navigator.geolocation.getCurrentPosition(async (position) => {
                setLoading(true);
                const query = `${position.coords.latitude}, ${position.coords.longitude}`;
                const result = await findStationId(query);
                if (result) {
                  setStation({ id: result.stationId, name: result.stationName });
                }
                setLoading(false);
              });
            }
          }}
          className="bg-slate-900 text-white px-6 py-4 rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3 font-bold border-4 border-white"
        >
          <Navigation className="w-5 h-5" /> Use My Location
        </button>
      </div>

      <footer className="mt-12 text-center text-slate-400 text-sm">
        <p>Predictions based on NOAA MLLW Datum. Always consult local warnings before coastal activities.</p>
        <p className="mt-1">Built with React, Gemini, and NOAA CO-OPS API.</p>
      </footer>
    </div>
  );
};

export default App;
