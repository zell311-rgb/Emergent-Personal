import React, { useEffect, useMemo, useState } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import './App.css';

import {
  addBalanceCheck,
  addGift,
  addPrincipalPayment,
  addWaist,
  addWeight,
  backendOrigin,
  getFitnessMetrics,
  getMortgageSummary,
  getSettings,
  getSummary,
  getTrip,
  getTripHistory,
  getWeeklyReview,
  listGifts,
  listMortgageEvents,
  listCheckIns,
  updateSettings,
  updateTrip,
  uploadPhoto,
  upsertCheckIn,
} from './api';

function isoToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function monthKeyFromIso(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function dollars(v) {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 100)}%`;
}

function Card({ title, right, children, testId }) {
  return (
    <section className="glass card" data-testid={testId}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 className="h1" style={{ fontSize: 16 }} data-testid={`${testId}-title`}>{title}</h2>
        {right}
      </div>
      <hr className="sep" />
      {children}
    </section>
  );
}

function Field({ label, children, testId }) {
  return (
    <div data-testid={testId}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState('dashboard');

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [summary, setSummary] = useState(null);
  const [weekly, setWeekly] = useState(null);

  const [checkDay, setCheckDay] = useState(isoToday());
  const [checkWake, setCheckWake] = useState(false);
  const [checkWorkout, setCheckWorkout] = useState(false);
  const [checkVideo, setCheckVideo] = useState(false);
  const [checkNotes, setCheckNotes] = useState('');
  const [recentCheckins, setRecentCheckins] = useState([]);

  const [fitnessRangeStart, setFitnessRangeStart] = useState(addDays(isoToday(), -90));
  const [fitnessRangeEnd, setFitnessRangeEnd] = useState(isoToday());
  const [fitness, setFitness] = useState({ metrics: [], photos: [], latest: {} });

  const [weightDay, setWeightDay] = useState(isoToday());
  const [weightVal, setWeightVal] = useState('');
  const [waistDay, setWaistDay] = useState(isoToday());
  const [waistVal, setWaistVal] = useState('');
  const [photoDay, setPhotoDay] = useState(isoToday());
  const [photoFile, setPhotoFile] = useState(null);

  const [mortgageRangeStart, setMortgageRangeStart] = useState(addDays(isoToday(), -120));
  const [mortgageRangeEnd, setMortgageRangeEnd] = useState(isoToday());
  const [mortgageEvents, setMortgageEvents] = useState([]);
  const [mortgageSummary, setMortgageSummary] = useState(null);
  const [paymentDay, setPaymentDay] = useState(isoToday());
  const [paymentAmt, setPaymentAmt] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [balanceDay, setBalanceDay] = useState(isoToday());
  const [balanceVal, setBalanceVal] = useState('');
  const [balanceNote, setBalanceNote] = useState('');

  const [trip, setTrip] = useState(null);
  const [tripHistory, setTripHistory] = useState([]);
  const [tripCalendarCursor, setTripCalendarCursor] = useState(new Date());
  const [giftDay, setGiftDay] = useState(isoToday());
  const [giftDesc, setGiftDesc] = useState('');
  const [giftAmt, setGiftAmt] = useState('');
  const [gifts, setGifts] = useState([]);

  const [settings, setSettings] = useState(null);

  const monthKey = useMemo(() => monthKeyFromIso(isoToday()), []);

  const fitnessSeries = useMemo(() => {
    const byDay = new Map();
    for (const m of fitness.metrics || []) {
      if (!byDay.has(m.day)) byDay.set(m.day, { day: m.day });
      if (m.kind === 'weight') byDay.get(m.day).weight = m.value;
      if (m.kind === 'waist') byDay.get(m.day).waist = m.value;
    }
    return Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
  }, [fitness]);

  const mortgageProgress = useMemo(() => {
    if (!mortgageSummary) return null;
    const targetDelta = mortgageSummary?.progress?.target_delta || (mortgageSummary.mortgage_start_principal - mortgageSummary.mortgage_target_principal);
    const paid = mortgageSummary?.progress?.paid_extra_ytd || 0;
    const ratio = targetDelta > 0 ? Math.min(1, paid / targetDelta) : 0;
    return { targetDelta, paid, ratio };
  }, [mortgageSummary]);

  async function refreshAll() {
    setErr('');
    setLoading(true);
    try {
      const [s, w, f, ms, me, t, th, gs, st] = await Promise.all([
        getSummary(),
        getWeeklyReview(),
        getFitnessMetrics(fitnessRangeStart, fitnessRangeEnd),
        getMortgageSummary(),
        listMortgageEvents(mortgageRangeStart, mortgageRangeEnd),
        getTrip(),
        getTripHistory(25),
        listGifts(monthKey.year, monthKey.month),
        getSettings(),
      ]);
      setSummary(s);
      setWeekly(w);
      setFitness(f);
      setMortgageSummary(ms);
      setMortgageEvents(me);
      setTrip(t);
      setTripHistory(th);
      setGifts(gs);
      setSettings(st);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCheckIn() {
    setErr('');
    try {
      const saved = await upsertCheckIn({
        day: checkDay,
        wakeup_5am: checkWake,
        workout: checkWorkout,
        video_captured: checkVideo,
        notes: checkNotes,
      });
      // refresh summary/weekly
      const [s, w] = await Promise.all([getSummary(), getWeeklyReview(checkDay)]);
      setSummary(s);
      setWeekly(w);
      return saved;
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to save check-in');
      return null;
    }
  }

  async function submitWeight() {
    setErr('');
    try {
      await addWeight({ day: weightDay, weight_lbs: Number(weightVal) });
      setWeightVal('');
      const [f, s] = await Promise.all([
        getFitnessMetrics(fitnessRangeStart, fitnessRangeEnd),
        getSummary(),
      ]);
      setFitness(f);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to add weight');
    }
  }

  async function submitWaist() {
    setErr('');
    try {
      await addWaist({ day: waistDay, waist_in: Number(waistVal) });
      setWaistVal('');
      const [f, s] = await Promise.all([
        getFitnessMetrics(fitnessRangeStart, fitnessRangeEnd),
        getSummary(),
      ]);
      setFitness(f);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to add waist');
    }
  }

  async function submitPhoto() {
    setErr('');
    try {
      if (!photoFile) {
        setErr('Choose a file first');
        return;
      }
      await uploadPhoto(photoDay, photoFile);
      setPhotoFile(null);
      const [f, s] = await Promise.all([
        getFitnessMetrics(fitnessRangeStart, fitnessRangeEnd),
        getSummary(),
      ]);
      setFitness(f);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to upload photo');
    }
  }

  async function submitPayment() {
    setErr('');
    try {
      await addPrincipalPayment({ day: paymentDay, amount: Number(paymentAmt), note: paymentNote });
      setPaymentAmt('');
      setPaymentNote('');
      const [ms, me, s] = await Promise.all([
        getMortgageSummary(),
        listMortgageEvents(mortgageRangeStart, mortgageRangeEnd),
        getSummary(),
      ]);
      setMortgageSummary(ms);
      setMortgageEvents(me);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to add payment');
    }
  }

  async function submitBalance() {
    setErr('');
    try {
      await addBalanceCheck({ day: balanceDay, principal_balance: Number(balanceVal), note: balanceNote });
      setBalanceVal('');
      setBalanceNote('');
      const [ms, me, s] = await Promise.all([
        getMortgageSummary(),
        listMortgageEvents(mortgageRangeStart, mortgageRangeEnd),
        getSummary(),
      ]);
      setMortgageSummary(ms);
      setMortgageEvents(me);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to add balance check');
    }
  }

  async function saveTrip(next) {
    setErr('');
    try {
      const t = await updateTrip(next);
      setTrip(t);
      const [s, th] = await Promise.all([getSummary(), getTripHistory(25)]);
      setSummary(s);
      setTripHistory(th);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to update trip');
    }
  }

  async function submitGift() {
    setErr('');
    try {
      await addGift({ day: giftDay, description: giftDesc, amount: giftAmt ? Number(giftAmt) : 0 });
      setGiftDesc('');
      setGiftAmt('');
      const [gs, s] = await Promise.all([
        listGifts(monthKey.year, monthKey.month),
        getSummary(),
      ]);
      setGifts(gs);
      setSummary(s);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to add gift');
    }
  }

  async function saveSettings() {
    setErr('');
    try {
      const st = await updateSettings(settings);
      setSettings(st);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Failed to save settings');
    }
  }

  const topKpis = useMemo(() => {
    if (!summary) return [];
    const mortgageRatio = mortgageProgress?.ratio ?? 0;
    return [
      { label: 'Wake-up streak (5AM)', value: String(summary.current_wakeup_streak), sub: `This week: ${summary.week_wakeup_count}/7` },
      { label: 'Workout streak', value: String(summary.current_workout_streak), sub: `This week: ${summary.week_workout_count}/5` },
      { label: 'Videos captured (week)', value: String(summary.week_video_count), sub: 'Target: 1–3 / week' },
      { label: 'Mortgage (extra principal YTD)', value: dollars(summary.principal_paid_extra_ytd), sub: `To target: ${pct(mortgageRatio)}` },
    ];
  }, [summary, mortgageProgress]);

  const reminderBadges = useMemo(() => {
    if (!summary?.reminders) return [];
    return summary.reminders.slice(0, 6);
  }, [summary]);

  if (loading) {
    return (
      <div className="app-shell" data-testid="app-loading">
        <div className="container">
          <div className="glass card" data-testid="loading-card">
            <h1 className="h1">2026 Accountability</h1>
            <p className="muted">Loading dashboard…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-testid="app-root">
      <header className="container" style={{ paddingBottom: 0 }}>
        <div className="glass card" data-testid="header-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 className="h1" data-testid="app-title">2026 Accountability</h1>
            <div className="muted" data-testid="app-subtitle">Executive dashboard for fitness, discipline, mortgage, documentation, relationship.</div>
          </div>
          <button className="btn" data-testid="refresh-button" onClick={refreshAll}>Refresh</button>
        </div>

        <div style={{ marginTop: 14 }} className="tabs" data-testid="nav-tabs">
          <button className="tab" data-testid="tab-dashboard" onClick={() => setActive('dashboard')}>Dashboard</button>
          <button className="tab" data-testid="tab-checkin" onClick={() => setActive('checkin')}>Daily Check-in</button>
          <button className="tab" data-testid="tab-fitness" onClick={() => setActive('fitness')}>Fitness</button>
          <button className="tab" data-testid="tab-mortgage" onClick={() => setActive('mortgage')}>Mortgage</button>
          <button className="tab" data-testid="tab-relationship" onClick={() => setActive('relationship')}>Relationship</button>
          <button className="tab" data-testid="tab-settings" onClick={() => setActive('settings')}>Settings</button>
        </div>

        {err ? (
          <div className="glass card" data-testid="error-banner" style={{ marginTop: 14, borderColor: 'rgba(255,86,105,0.35)', background: 'rgba(255,86,105,0.10)' }}>
            <strong>Issue:</strong> {err}
          </div>
        ) : null}
      </header>

      <main className="container" style={{ paddingTop: 14 }}>
        {active === 'dashboard' ? (
          <div className="grid" data-testid="dashboard-view">
            <div className="col-12 glass card" data-testid="dashboard-kpis">
              <div className="grid">
                {topKpis.map((k) => (
                  <div key={k.label} className="col-3" data-testid={`kpi-${k.label.replace(/\s+/g, '-').toLowerCase()}`}>
                    <div className="kpi">
                      <div className="muted">{k.label}</div>
                      <div className="value">{k.value}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{k.sub}</div>
                    </div>
                  </div>
                ))}
              </div>

              <hr className="sep" />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }} data-testid="reminders-list">
                {reminderBadges.length ? reminderBadges.map((r) => (
                  <span key={r.id} className={`badge ${r.severity === 'warning' ? 'warn' : 'info'}`} data-testid={`reminder-${r.id}`}>
                    <strong>{r.area}</strong> — {r.message}
                  </span>
                )) : (
                  <span className="badge info" data-testid="reminder-none">No reminders right now.</span>
                )}
              </div>
            </div>

            <div className="col-6" data-testid="dashboard-fitness-card">
              <Card title="Fitness" testId="fitness-summary-card" right={<span className="badge" data-testid="fitness-target">Abs by Apr 15, 2026</span>}>
                <div className="grid">
                  <div className="col-6" data-testid="latest-weight">
                    <div className="muted">Latest weight</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{summary?.latest_weight_lbs ? `${summary.latest_weight_lbs} lbs` : '—'}</div>
                  </div>
                  <div className="col-6" data-testid="latest-waist">
                    <div className="muted">Latest waist</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{summary?.latest_waist_in ? `${summary.latest_waist_in} in` : '—'}</div>
                  </div>
                </div>
                <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                  Rules: protein 140–150g/day, no liquid calories, no eating after toddler bedtime.
                </div>
              </Card>
            </div>

            <div className="col-6" data-testid="dashboard-weekly-card">
              <Card title="Weekly Review (auto)" testId="weekly-summary-card" right={<span className="badge" data-testid="weekly-window">Sun–Sat</span>}>
                {weekly ? (
                  <div data-testid="weekly-review-status">
                    <div className="grid">
                      <div className="col-6"><span className="badge" data-testid="weekly-wakeups">Wakeups ≥4: {weekly.wakeups_ge_4 ? '✔' : '✘'}</span></div>
                      <div className="col-6"><span className="badge" data-testid="weekly-workouts">Workouts ≥5: {weekly.workouts_completed_5 ? '✔' : '✘'}</span></div>
                      <div className="col-6"><span className="badge" data-testid="weekly-video">Video ≥1: {weekly.captured_at_least_1_video ? '✔' : '✘'}</span></div>
                      <div className="col-6"><span className="badge" data-testid="weekly-mortgage">Mortgage action: {weekly.mortgage_action_taken ? '✔' : '✘'}</span></div>
                      <div className="col-6"><span className="badge" data-testid="weekly-relationship">Relationship action: {weekly.relationship_action_taken ? '✔' : '✘'}</span></div>
                    </div>
                    <div className="muted" style={{ marginTop: 10, fontSize: 12 }} data-testid="weekly-range">
                      Week: {weekly.week_start} → {weekly.week_end}
                    </div>
                  </div>
                ) : (
                  <div className="muted" data-testid="weekly-review-empty">No data yet.</div>
                )}
              </Card>
            </div>

            <div className="col-12" data-testid="dashboard-mortgage-card">
              <Card title="Mortgage" testId="mortgage-summary-card" right={<span className="badge" data-testid="mortgage-target">$330k → &lt;$300k by Dec 31, 2026</span>}>
                {mortgageSummary ? (
                  <div data-testid="mortgage-progress">
                    <div className="grid">
                      <div className="col-3">
                        <div className="muted">Start</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(mortgageSummary.mortgage_start_principal)}</div>
                      </div>
                      <div className="col-3">
                        <div className="muted">Target</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(mortgageSummary.mortgage_target_principal)}</div>
                      </div>
                      <div className="col-3">
                        <div className="muted">Latest balance</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(mortgageSummary.latest_principal_balance)}</div>
                      </div>
                      <div className="col-3">
                        <div className="muted">Extra principal (YTD)</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>{dollars(mortgageSummary.principal_paid_extra_ytd)}</div>
                      </div>
                    </div>

                    {mortgageProgress ? (
                      <div style={{ marginTop: 12 }} data-testid="mortgage-progress-bar">
                        <div className="muted" style={{ fontSize: 12 }}>Progress to $30,001 target: {pct(mortgageProgress.ratio)}</div>
                        <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                          <div style={{ width: `${Math.round(mortgageProgress.ratio * 100)}%`, height: '100%', background: 'rgba(64, 221, 153, 0.55)' }} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="muted" data-testid="mortgage-empty">No data.</div>
                )}
              </Card>
            </div>
          </div>
        ) : null}

        {active === 'checkin' ? (
          <div className="grid" data-testid="checkin-view">
            <div className="col-6">
              <Card title="Daily check-in" testId="checkin-card" right={<span className="badge" data-testid="checkin-rule">Binary ✔ / ✘</span>}>
                <Field label="Day" testId="checkin-day-field">
                  <input className="input" data-testid="checkin-day-input" type="date" value={checkDay} onChange={(e) => setCheckDay(e.target.value)} />
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 10 }} data-testid="checkin-toggles">
                  <label className="badge" data-testid="toggle-wakeup">
                    <input type="checkbox" checked={checkWake} onChange={(e) => setCheckWake(e.target.checked)} style={{ marginRight: 8 }} />
                    Wake-up 5:00 AM
                  </label>
                  <label className="badge" data-testid="toggle-workout">
                    <input type="checkbox" checked={checkWorkout} onChange={(e) => setCheckWorkout(e.target.checked)} style={{ marginRight: 8 }} />
                    Workout completed
                  </label>
                  <label className="badge" data-testid="toggle-video">
                    <input type="checkbox" checked={checkVideo} onChange={(e) => setCheckVideo(e.target.checked)} style={{ marginRight: 8 }} />
                    Video captured
                  </label>
                </div>

                <div style={{ marginTop: 10 }}>
                  <Field label="Notes (optional)" testId="checkin-notes-field">
                    <textarea className="textarea" data-testid="checkin-notes-input" value={checkNotes} onChange={(e) => setCheckNotes(e.target.value)} placeholder="2-minute evening check. Any blockers?" />
                  </Field>
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                  <button className="btn primary" data-testid="checkin-save-button" onClick={saveCheckIn}>Save</button>
                </div>
              </Card>
            </div>

            <div className="col-6">
              <Card title="Quick context" testId="checkin-context-card" right={<span className="badge" data-testid="sleep-rule">Lights out 9:30–9:45</span>}>
                <div className="muted" style={{ fontSize: 13 }} data-testid="checkin-context-text">
                  If you miss 2 wake-ups in a week, move bedtime earlier by 15 minutes the following week.
                </div>
              </Card>

              <Card title="Recent check-ins (14 days)" testId="recent-checkins-card" right={<button className="btn" data-testid="load-recent-checkins" onClick={async () => {
                setErr('');
                try {
                  const end = isoToday();
                  const start = addDays(end, -13);
                  const rows = await listCheckIns(start, end);
                  setRecentCheckins(rows.slice().reverse());
                } catch (e) {
                  setErr(e?.response?.data?.detail || e.message || 'Failed to load recent');
                }
              }}>Load</button>}>
                <div style={{ marginTop: 10 }} data-testid="recent-checkins-table">
                  {recentCheckins.length ? (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>5AM</th>
                          <th>Workout</th>
                          <th>Video</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentCheckins.map((c) => (
                          <tr key={c.id} data-testid={`recent-checkin-row-${c.id}`}>
                            <td>{c.day}</td>
                            <td>{c.wakeup_5am ? '✔' : '✘'}</td>
                            <td>{c.workout ? '✔' : '✘'}</td>
                            <td>{c.video_captured ? '✔' : '✘'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }} data-testid="recent-checkins-hint">
                      Click “Load” to view your last 14 days.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {active === 'fitness' ? (
          <div className="grid" data-testid="fitness-view">
            <div className="col-12">
              <Card title="Fitness trend" testId="fitness-trend-card" right={<span className="badge" data-testid="fitness-range">{fitnessRangeStart} → {fitnessRangeEnd}</span>}>
                <div className="grid">
                  <div className="col-4">
                    <Field label="Range start" testId="fitness-start-field">
                      <input className="input" data-testid="fitness-start-input" type="date" value={fitnessRangeStart} onChange={(e) => setFitnessRangeStart(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-4">
                    <Field label="Range end" testId="fitness-end-field">
                      <input className="input" data-testid="fitness-end-input" type="date" value={fitnessRangeEnd} onChange={(e) => setFitnessRangeEnd(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-4" style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                    <button className="btn" data-testid="fitness-refresh-button" onClick={async () => {
                      setErr('');
                      try {
                        const f = await getFitnessMetrics(fitnessRangeStart, fitnessRangeEnd);
                        setFitness(f);
                      } catch (e) {
                        setErr(e?.response?.data?.detail || e.message || 'Failed to refresh');
                      }
                    }}>Refresh range</button>
                  </div>
                </div>

                <div style={{ height: 320, marginTop: 12 }} data-testid="fitness-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={fitnessSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="day" stroke="rgba(255,255,255,0.55)" />
                      <YAxis yAxisId="left" stroke="rgba(255,255,255,0.55)" />
                      <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.55)" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="weight" name="Weight (lbs)" stroke="rgba(86,105,255,0.9)" dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="waist" name="Waist (in)" stroke="rgba(64,221,153,0.9)" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="col-4">
              <Card title="Log weight" testId="log-weight-card">
                <Field label="Day" testId="weight-day-field">
                  <input className="input" data-testid="weight-day-input" type="date" value={weightDay} onChange={(e) => setWeightDay(e.target.value)} />
                </Field>
                <Field label="Weight (lbs)" testId="weight-val-field">
                  <input className="input" data-testid="weight-val-input" inputMode="decimal" value={weightVal} onChange={(e) => setWeightVal(e.target.value)} placeholder="e.g., 169" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" data-testid="weight-submit-button" onClick={submitWeight}>Add weight</button>
                </div>
              </Card>
            </div>

            <div className="col-4">
              <Card title="Log waist" testId="log-waist-card">
                <Field label="Day" testId="waist-day-field">
                  <input className="input" data-testid="waist-day-input" type="date" value={waistDay} onChange={(e) => setWaistDay(e.target.value)} />
                </Field>
                <Field label="Waist (in)" testId="waist-val-field">
                  <input className="input" data-testid="waist-val-input" inputMode="decimal" value={waistVal} onChange={(e) => setWaistVal(e.target.value)} placeholder="e.g., 33.5" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" data-testid="waist-submit-button" onClick={submitWaist}>Add waist</button>
                </div>
              </Card>
            </div>

            <div className="col-4">
              <Card title="Monthly progress photo" testId="log-photo-card">
                <Field label="Day" testId="photo-day-field">
                  <input className="input" data-testid="photo-day-input" type="date" value={photoDay} onChange={(e) => setPhotoDay(e.target.value)} />
                </Field>
                <Field label="File" testId="photo-file-field">
                  <input className="input" data-testid="photo-file-input" type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
                </Field>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="btn primary" data-testid="photo-upload-button" onClick={submitPhoto}>Upload</button>
                  <span className="muted" data-testid="photo-help" style={{ fontSize: 12 }}>Stored privately in your tracker.</span>
                </div>
                {(fitness.photos?.length ?? 0) > 0 ? (
                  <div style={{ marginTop: 12 }} data-testid="photo-gallery">
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Recent photos</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {fitness.photos.slice(0, 6).map((p) => (
                        <a key={p.id} href={`${backendOrigin()}${p.url}`} target="_blank" rel="noreferrer" data-testid={`photo-link-${p.id}`}>
                          <div className="glass" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.10)' }}>
                            <img alt="progress" src={`${backendOrigin()}${p.url}`} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>
          </div>
        ) : null}

        {active === 'mortgage' ? (
          <div className="grid" data-testid="mortgage-view">
            <div className="col-12">
              <Card title="Mortgage overview" testId="mortgage-overview-card" right={<span className="badge" data-testid="mortgage-overview-target">Target: &lt;$300k principal</span>}>
                {mortgageSummary ? (
                  <div className="grid" data-testid="mortgage-overview-kpis">
                    <div className="col-3">
                      <div className="muted">Extra principal (month)</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{dollars(mortgageSummary.principal_paid_extra_month)}</div>
                    </div>
                    <div className="col-3">
                      <div className="muted">Extra principal (YTD)</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{dollars(mortgageSummary.principal_paid_extra_ytd)}</div>
                    </div>
                    <div className="col-3">
                      <div className="muted">Latest balance</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{dollars(mortgageSummary.latest_principal_balance)}</div>
                    </div>
                    <div className="col-3">
                      <div className="muted">Target delta</div>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{dollars((mortgageSummary.mortgage_start_principal - mortgageSummary.mortgage_target_principal))}</div>
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>

            <div className="col-6">
              <Card title="Log extra principal payment" testId="mortgage-payment-card">
                <Field label="Day" testId="payment-day-field">
                  <input className="input" data-testid="payment-day-input" type="date" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value)} />
                </Field>
                <Field label="Amount (USD)" testId="payment-amount-field">
                  <input className="input" data-testid="payment-amount-input" inputMode="decimal" value={paymentAmt} onChange={(e) => setPaymentAmt(e.target.value)} placeholder="e.g., 1500" />
                </Field>
                <Field label="Note (optional)" testId="payment-note-field">
                  <input className="input" data-testid="payment-note-input" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Principal-only payment" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" data-testid="payment-submit-button" onClick={submitPayment}>Add payment</button>
                </div>
              </Card>
            </div>

            <div className="col-6">
              <Card title="Monthly principal balance check" testId="mortgage-balance-card">
                <Field label="Day" testId="balance-day-field">
                  <input className="input" data-testid="balance-day-input" type="date" value={balanceDay} onChange={(e) => setBalanceDay(e.target.value)} />
                </Field>
                <Field label="Principal balance (USD)" testId="balance-value-field">
                  <input className="input" data-testid="balance-value-input" inputMode="decimal" value={balanceVal} onChange={(e) => setBalanceVal(e.target.value)} placeholder="e.g., 328500" />
                </Field>
                <Field label="Note (optional)" testId="balance-note-field">
                  <input className="input" data-testid="balance-note-input" value={balanceNote} onChange={(e) => setBalanceNote(e.target.value)} placeholder="From lender portal" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" data-testid="balance-submit-button" onClick={submitBalance}>Add balance check</button>
                </div>
              </Card>
            </div>

            <div className="col-12">
              <Card title="Events" testId="mortgage-events-card" right={<span className="badge" data-testid="mortgage-events-range">{mortgageRangeStart} → {mortgageRangeEnd}</span>}>
                <div className="grid">
                  <div className="col-4">
                    <Field label="Range start" testId="mortgage-start-field">
                      <input className="input" data-testid="mortgage-start-input" type="date" value={mortgageRangeStart} onChange={(e) => setMortgageRangeStart(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-4">
                    <Field label="Range end" testId="mortgage-end-field">
                      <input className="input" data-testid="mortgage-end-input" type="date" value={mortgageRangeEnd} onChange={(e) => setMortgageRangeEnd(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-4" style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                    <button className="btn" data-testid="mortgage-refresh-button" onClick={async () => {
                      setErr('');
                      try {
                        const me = await listMortgageEvents(mortgageRangeStart, mortgageRangeEnd);
                        setMortgageEvents(me);
                      } catch (e) {
                        setErr(e?.response?.data?.detail || e.message || 'Failed to refresh');
                      }
                    }}>Refresh</button>
                  </div>
                </div>

                <div style={{ marginTop: 12 }} data-testid="mortgage-events-table">
                  {mortgageEvents.length ? (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mortgageEvents.slice().reverse().map((e) => (
                          <tr key={e.id} data-testid={`mortgage-event-${e.id}`}>
                            <td>{e.day}</td>
                            <td>{e.kind === 'balance_check' ? 'Balance check' : 'Principal payment'}</td>
                            <td>{dollars(e.amount)}</td>
                            <td className="muted">{e.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="muted" data-testid="mortgage-events-empty">No events in this range yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {active === 'relationship' ? (
          <div className="grid" data-testid="relationship-view">
            <div className="col-6">
              <Card title="Vacation planner" testId="trip-card" right={<span className="badge" data-testid="trip-deadline">Due Feb 15 (dates/bookings)</span>}>
                {trip ? (
                  <div data-testid="trip-form">
                    <div className="grid">
                      <div className="col-8">
                        <Field label="Dates (freeform)" testId="trip-dates-field">
                          <input className="input" data-testid="trip-dates-input" value={trip.dates || ''} onChange={(e) => setTrip({ ...trip, dates: e.target.value })} placeholder="e.g., Mar 12–15" />
                        </Field>
                      </div>
                      <div className="col-4">
                        <Field label="Trip type" testId="trip-adults-only-field">
                          <label className="badge" data-testid="trip-adults-only-toggle" style={{ width: 'fit-content' }}>
                            <input type="checkbox" checked={!!trip.adults_only} onChange={(e) => setTrip({ ...trip, adults_only: e.target.checked })} style={{ marginRight: 8 }} />
                            Adults-only
                          </label>
                        </Field>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 10 }}>
                      <label className="badge" data-testid="trip-lodging-toggle">
                        <input type="checkbox" checked={!!trip.lodging_booked} onChange={(e) => setTrip({ ...trip, lodging_booked: e.target.checked })} style={{ marginRight: 8 }} />
                        Lodging booked
                      </label>
                      <label className="badge" data-testid="trip-childcare-toggle">
                        <input type="checkbox" checked={!!trip.childcare_confirmed} onChange={(e) => setTrip({ ...trip, childcare_confirmed: e.target.checked })} style={{ marginRight: 8 }} />
                        Childcare confirmed
                      </label>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <Field label="Notes" testId="trip-notes-field">
                        <textarea className="textarea" data-testid="trip-notes-input" value={trip.notes || ''} onChange={(e) => setTrip({ ...trip, notes: e.target.value })} placeholder="Ideas, locations, childcare plan…" />
                      </Field>
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button className="btn primary" data-testid="trip-save-button" onClick={() => saveTrip(trip)}>Save plan</button>
                      <span className="muted" data-testid="trip-updated-at" style={{ fontSize: 12 }}>Last updated: {trip.updated_at || '—'}</span>
                    </div>

                    <hr className="sep" />

                    <div data-testid="trip-history">
                      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }} data-testid="trip-history-title">History (last 25 saves)</div>
                      {tripHistory.length ? (
                        <table className="table" data-testid="trip-history-table">
                          <thead>
                            <tr>
                              <th>Saved at</th>
                              <th>Dates</th>
                              <th>Adults-only</th>
                              <th>Lodging</th>
                              <th>Childcare</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tripHistory.map((h) => (
                              <tr key={h.id} data-testid={`trip-history-row-${h.id}`}>
                                <td className="muted">{h.created_at}</td>
                                <td>{h.snapshot?.dates || '—'}</td>
                                <td>{h.snapshot?.adults_only ? 'Yes' : 'No'}</td>
                                <td>{h.snapshot?.lodging_booked ? '✔' : '✘'}</td>
                                <td>{h.snapshot?.childcare_confirmed ? '✔' : '✘'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="muted" data-testid="trip-history-empty">No history yet. Saving will create snapshots.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="muted" data-testid="trip-empty">Loading…</div>
                )}
              </Card>
            </div>

            <div className="col-6">
              <Card title="Monthly spontaneous gift" testId="gift-card" right={<span className="badge" data-testid="gift-rule">Reminder on the 1st</span>}>
                <Field label="Day" testId="gift-day-field">
                  <input className="input" data-testid="gift-day-input" type="date" value={giftDay} onChange={(e) => setGiftDay(e.target.value)} />
                </Field>
                <Field label="Description" testId="gift-desc-field">
                  <input className="input" data-testid="gift-desc-input" value={giftDesc} onChange={(e) => setGiftDesc(e.target.value)} placeholder="Flowers, note, planned experience…" />
                </Field>
                <Field label="Amount (optional)" testId="gift-amount-field">
                  <input className="input" data-testid="gift-amount-input" inputMode="decimal" value={giftAmt} onChange={(e) => setGiftAmt(e.target.value)} placeholder="e.g., 35" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" data-testid="gift-submit-button" onClick={submitGift}>Add gift</button>
                </div>

                <hr className="sep" />

                <div data-testid="gift-log">
                  {gifts.length ? (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th>Description</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gifts.map((g) => (
                          <tr key={g.id} data-testid={`gift-row-${g.id}`}>
                            <td>{g.day}</td>
                            <td>{g.description}</td>
                            <td>{g.amount ? dollars(g.amount) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="muted" data-testid="gift-empty">No gifts logged this month yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {active === 'settings' ? (
          <div className="grid" data-testid="settings-view">
            <div className="col-8">
              <Card title="Email & reminder settings" testId="settings-card" right={<span className="badge" data-testid="settings-provider">Provider: SendGrid (optional)</span>}>
                {settings ? (
                  <div data-testid="settings-form">
                    <div className="glass" style={{ borderRadius: 14, padding: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }} data-testid="settings-note">
                      <div style={{ fontWeight: 650 }}>You can set this up later.</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Until you add a SendGrid account and verify a sender, emails are disabled. In-app reminders still work.
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <label className="badge" data-testid="email-enabled-toggle">
                        <input type="checkbox" checked={!!settings.email_enabled} onChange={(e) => setSettings({ ...settings, email_enabled: e.target.checked })} style={{ marginRight: 8 }} />
                        Enable email reminders
                      </label>
                    </div>

                    <div className="grid" style={{ marginTop: 12 }}>
                      <div className="col-6">
                        <Field label="SendGrid API key" testId="sendgrid-key-field">
                          <input className="input" data-testid="sendgrid-key-input" type="password" value={settings.sendgrid_api_key || ''} onChange={(e) => setSettings({ ...settings, sendgrid_api_key: e.target.value })} placeholder="SG.***" />
                        </Field>
                      </div>
                      <div className="col-6">
                        <Field label="Verified sender email" testId="sendgrid-sender-field">
                          <input className="input" data-testid="sendgrid-sender-input" value={settings.sendgrid_sender_email || ''} onChange={(e) => setSettings({ ...settings, sendgrid_sender_email: e.target.value })} placeholder="you@domain.com" />
                        </Field>
                      </div>
                      <div className="col-6">
                        <Field label="Recipient email" testId="sendgrid-recipient-field">
                          <input className="input" data-testid="sendgrid-recipient-input" value={settings.reminder_recipient_email || ''} onChange={(e) => setSettings({ ...settings, reminder_recipient_email: e.target.value })} placeholder="recipient@email.com" />
                        </Field>
                      </div>
                      <div className="col-3">
                        <Field label="Weekly review day" testId="weekly-day-field">
                          <select className="input" data-testid="weekly-day-select" value={settings.weekly_review_day} onChange={(e) => setSettings({ ...settings, weekly_review_day: e.target.value })}>
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="col-3">
                        <Field label="Weekly hour (local)" testId="weekly-hour-field">
                          <input className="input" data-testid="weekly-hour-input" type="number" min={0} max={23} value={settings.weekly_review_hour_local} onChange={(e) => setSettings({ ...settings, weekly_review_hour_local: Number(e.target.value) })} />
                        </Field>
                      </div>
                      <div className="col-3">
                        <Field label="Monthly gift day" testId="monthly-gift-field">
                          <input className="input" data-testid="monthly-gift-input" type="number" min={1} max={28} value={settings.monthly_gift_day} onChange={(e) => setSettings({ ...settings, monthly_gift_day: Number(e.target.value) })} />
                        </Field>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                      <button className="btn primary" data-testid="settings-save-button" onClick={saveSettings}>Save settings</button>
                    </div>

                    <div className="muted" style={{ marginTop: 10, fontSize: 12 }} data-testid="settings-security">
                      Note: in this MVP, the SendGrid API key is stored in your database to keep setup easy. When you’re ready to productionize, we should move it to an environment secret.
                    </div>
                  </div>
                ) : (
                  <div className="muted" data-testid="settings-empty">Loading…</div>
                )}
              </Card>
            </div>

            <div className="col-4">
              <Card title="Data" testId="settings-data-card">
                <div className="muted" style={{ fontSize: 13 }} data-testid="settings-data-text">
                  This app is locked to the 2026 plan. No login (single user). Data is stored locally in MongoDB.
                </div>
              </Card>
            </div>
          </div>
        ) : null}
      </main>

      <footer className="container" style={{ paddingTop: 0 }}>
        <div className="muted" style={{ fontSize: 12 }} data-testid="footer-text">
          Tip: keep it frictionless. Only log what drives action.
        </div>
      </footer>
    </div>
  );
}
