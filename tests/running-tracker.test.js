import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRunningTracker, distanceBetween } from '../src/app/running-tracker.js';

const descriptors = {};
const saved = {};
const watches = new Map();
let nextWatch = 1;
let previous = {};

beforeEach(() => {
  for (const key of ['window', 'navigator', 'localStorage']) previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => saved[k] ?? null, setItem: (k,v) => { saved[k] = v; }, removeItem: (k) => { delete saved[k]; } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    watchPosition: (success, error) => { const id = nextWatch++; watches.set(id, { success, error }); return id; },
    clearWatch: (id) => watches.delete(id),
  } } });
});

afterEach(() => {
  for (const id of watches.keys()) watches.delete(id);
  for (const key of ['window', 'navigator', 'localStorage']) {
    if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
    else delete globalThis[key];
  }
});

test('calcula distancia geográfica entre puntos GPS', () => {
  assert.ok(distanceBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }) > 110);
  assert.equal(distanceBetween({ lat: -19, lon: -65 }, { lat: -19, lon: -65 }), 0);
});

test('pausa, reanuda en un tramo separado y conserva la sesión local', () => {
  const tracker = createRunningTracker('runner-test');
  assert.equal(tracker.start(), true);
  const send = (point) => [...watches.values()].at(-1).success({ coords: { latitude: point.lat, longitude: point.lon, accuracy: point.accuracy ?? 5, altitude: null }, timestamp: point.at });
  send({ lat: -19, lon: -65, at: 100000 });
  send({ lat: -19, lon: -64.9999, at: 105000 });
  const distanceBeforePause = tracker.distanceKm();
  assert.ok(distanceBeforePause > 0.009 && distanceBeforePause < 0.012);
  tracker.pause();
  assert.equal(watches.size, 0);
  tracker.resume();
  send({ lat: -19, lon: -64.9998, at: 110000 });
  send({ lat: -19, lon: -64.9997, at: 115000 });
  const result = tracker.finish();
  assert.equal(result.route_segments.length, 2);
  assert.ok(result.distance_km > distanceBeforePause * 1.9);
  assert.equal(createRunningTracker('another-user').state, null);
  tracker.discard();
  assert.equal(createRunningTracker('runner-test').state, null);
});

test('ignora mala precisión y abre un tramo tras interrupción larga', () => {
  const tracker = createRunningTracker('runner-gaps');
  tracker.start();
  const send = (point) => [...watches.values()].at(-1).success({ coords: { latitude: point.lat, longitude: point.lon, accuracy: point.accuracy ?? 5, altitude: null }, timestamp: point.at });
  send({ lat: -19, lon: -65, at: 100000 });
  send({ lat: -19, lon: -64.9999, at: 105000 });
  const before = tracker.distanceKm();
  send({ lat: -19, lon: -64.9998, accuracy: 90, at: 110000 });
  send({ lat: -19, lon: -64.9997, at: 180000 });
  send({ lat: -19, lon: -64.9996, at: 185000 });
  const result = tracker.finish();
  assert.equal(result.route_segments.length, 2);
  assert.ok(result.distance_km > before * 1.9 && result.distance_km < before * 2.1);
  tracker.discard();
});
