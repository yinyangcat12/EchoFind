import { createHash, randomBytes } from 'node:crypto';
function fieldText(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item !== null ? item.text || item.name || '' : String(item)).join('');
  if (typeof value === 'object' && value !== null) return String(value.text || value.name || '');
  return String(value ?? '');
}
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = fieldText(value).trim().replace(/%$/, '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function timeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fieldText(value);
}
function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return /^(true|1|是|已存入|存入|yes|y)$/i.test(fieldText(value).trim());
}
// Dynamic signal positions are calculated on a distance ring, clipped to the
// actual square footprint. Both receivers may cover either side of the room.
// Keep the entire .22 m marker halo off outer walls, not just its center.
const ROOM_LIMIT = 5.65;

const TWO_PI = Math.PI * 2;

function resolveStation(value) {
  const text = fieldText(value).trim();
  if (/^(LeftUpper|左上|左上角|基站1|1)$/i.test(text)) return 'LeftUpper';
  if (/^(RightLower|右下|右下角|基站2|2)$/i.test(text)) return 'RightLower';
  return null;
}
function usableRingArcs(sx, sz, radius) {
  // Rectangle/circle intersection angles divide the ring into valid and
  // invalid arcs. Include partition boundaries to keep markers out of walls.
  const angles = [0, TWO_PI];
  const add = angle => angles.push((angle % TWO_PI + TWO_PI) % TWO_PI);
  for (const x of [-ROOM_LIMIT, ROOM_LIMIT, -.4, .4]) {
    const ratio = (x - sx) / radius;
    if (Math.abs(ratio) <= 1) { const angle = Math.acos(ratio); add(angle); add(-angle); }
  }
  for (const z of [-ROOM_LIMIT, ROOM_LIMIT, 3.95]) {
    const ratio = (z - sz) / radius;
    if (Math.abs(ratio) <= 1) { const angle = Math.asin(ratio); add(angle); add(Math.PI - angle); }
  }
  angles.sort((a, b) => a - b);
  const arcs = [];
  for (let i = 0; i < angles.length - 1; i++) {
    const from = angles[i], to = angles[i + 1];
    if (to - from < 1e-10) continue;
    const middle = (from + to) / 2;
    const x = sx + Math.cos(middle) * radius, z = sz + Math.sin(middle) * radius;
    if (x < -ROOM_LIMIT || x > ROOM_LIMIT || z < -ROOM_LIMIT || z > ROOM_LIMIT) continue;
    if (Math.abs(x) < .4 && z < 3.95) continue;
    arcs.push([from, to]);
  }
  return arcs;
}
function roomPosition(id, strength, stationValue = '', placementSeed = '', defaultStation = 'LeftUpper') {
  const specifiedStation = resolveStation(stationValue);
  // This table currently contains only upper-left receiver measurements.
  // Never invent a second receiver identity from an item's hash.
  const station = specifiedStation || resolveStation(defaultStation) || 'LeftUpper';
  const [sx, sz] = station === 'LeftUpper' ? [-5.62, -5.62] : [5.62, 5.62];
  const minimumDistance = .45;
  const maximumDistance = Math.hypot(ROOM_LIMIT + Math.abs(sx), ROOM_LIMIT + Math.abs(sz)) - .35;
  const clampedStrength = Math.max(0, Math.min(100, strength));
  const distance = minimumDistance + (100 - clampedStrength) / 100 * (maximumDistance - minimumDistance);
  const arcs = usableRingArcs(sx, sz, distance);
  const totalLength = arcs.reduce((sum, [from, to]) => sum + to - from, 0);
  if (!totalLength) throw new Error('Signal radius has no usable room intersection.');
  // One random page seed, not one random poll: unchanged data stays still.
  // A manual reload changes this seed and generates a new layout.
  const angleBytes = placementSeed
    ? createHash('sha256').update(`${placementSeed}:${id}:${station}`).digest()
    : randomBytes(4);
  let offset = angleBytes.readUInt32BE(0) / 0x100000000 * totalLength;
  let angle = 0;
  for (const [from, to] of arcs) {
    const length = to - from;
    if (offset <= length) { angle = from + Math.min(length * .999999, Math.max(length * .000001, offset)); break; }
    offset -= length;
  }
  // No coordinate clamp: it would destroy the strength-to-distance relationship.
  const x = sx + Math.cos(angle) * distance, z = sz + Math.sin(angle) * distance;
  return {
    station, stationSource: specifiedStation ? 'record' : 'data-source',
    distance: Number(distance.toFixed(3)),
    position: { x: Number(x.toFixed(3)), y: .16, z: Number(z.toFixed(3)) },
  };
}
export function normalizeRoomItems(records, placementSeed = '', defaultStation = 'LeftUpper') {
  const items = [];
  for (const record of records) {
    const fields = record?.fields || {};
    const strength = numberValue(fields['强度']);
    if (strength === null || !Number.isFinite(strength)) continue;
    const id = fieldText(record.record_id || fields['编号'] || fields['物品名称']).trim();
    if (!id) continue;
    const number = fieldText(fields['编号']).trim() || id;
    const name = fieldText(fields['物品名称'] || fields['名称']).trim() || `物品 ${number}`;
    const stationValue = fields['基站'] ?? fields['信号基站'] ?? fields['基站编号'];
    const location = roomPosition(number, strength, stationValue, placementSeed, defaultStation);
    items.push({
      id,
      number,
      name,
      strength: Number(Math.max(0, Math.min(100, strength)).toFixed(2)),
      time: timeValue(fields['时间']),
      stored: booleanValue(fields['是否存入']),
      station: location.station,
      stationSource: location.stationSource,
      distance: location.distance,
      position: location.position,
    });
  }
  return items;
}
