import axios from 'axios';

// IMPORTANT:
// - Prefer REACT_APP_BACKEND_URL when present (production-configured).
// - Fallback to same-origin for environments where ingress routes /api to backend.
// - We do NOT hardcode any URLs or ports.
const baseURL = process.env.REACT_APP_BACKEND_URL || window.location.origin;

export const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const pw = window.localStorage.getItem('app_password') || '';
  if (pw) {
    config.headers = config.headers || {};
    config.headers['x-app-password'] = pw;
  }
  return config;
});

export function backendOrigin() {
  return baseURL;
}

export async function getSummary() {
  const { data } = await api.get('/api/summary');
  return data;
}

export async function upsertCheckIn(payload) {
  const { data } = await api.post('/api/checkins/upsert', payload);
  return data;
}

export async function listCheckIns(start, end) {
  const { data } = await api.get('/api/checkins', { params: { start, end } });
  return data;
}

export async function addWeight(payload) {
  const { data } = await api.post('/api/fitness/weight', payload);
  return data;
}

export async function addBodyFat(payload) {
  const { data } = await api.post('/api/fitness/body-fat', payload);
  return data;
}

export async function getFitnessMetrics(start, end) {
  const { data } = await api.get('/api/fitness/metrics', { params: { start, end } });
  return data;
}

export async function uploadPhoto(day, file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/api/fitness/photo', form, {
    params: { day },
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function addPrincipalPayment(payload) {
  const { data } = await api.post('/api/mortgage/principal-payment', payload);
  return data;
}

export async function addBalanceCheck(payload) {
  const { data } = await api.post('/api/mortgage/balance-check', payload);
  return data;
}

export async function listMortgageEvents(start, end) {
  const { data } = await api.get('/api/mortgage/events', { params: { start, end } });
  return data;
}

export async function getMortgageSummary() {
  const { data } = await api.get('/api/mortgage/summary');
  return data;
}

export async function getTrip() {
  const { data } = await api.get('/api/relationship/trip');
  return data;
}

export async function getTripHistory(limit = 25) {
  const { data } = await api.get('/api/relationship/trip/history', { params: { limit } });
  return data;
}

export async function updateTrip(payload) {
  const { data } = await api.put('/api/relationship/trip', payload);
  return data;
}

export async function addGift(payload) {
  const { data } = await api.post('/api/relationship/gifts', payload);
  return data;
}

export async function listGifts(year, month) {
  const { data } = await api.get('/api/relationship/gifts', { params: { year, month } });
  return data;
}

export async function getSettings() {
  const { data } = await api.get('/api/settings');
  return data;
}

export async function updateSettings(payload) {
  const { data } = await api.put('/api/settings', payload);
  return data;
}

export async function getWeeklyReview(anchor_day) {
  const { data } = await api.get('/api/review/weekly', { params: { anchor_day } });
  return data;
}

export async function adminReset(confirm = 'RESET') {
  const { data } = await api.post('/api/admin/reset', null, { params: { confirm } });
  return data;
}
