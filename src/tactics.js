// Small, deterministic tactical queries. They consume sensed positions only.
export function chooseLane(actors, team, self, lanes = [-6.8, -0.4, 6.8], random = Math.random) {
  const count = lanes.map(lane => actors.reduce((n, a) => n + (a !== self && a.alive && a.team === team && a.lane === lane ? 1 : 0), 0));
  const min = Math.min(...count), free = lanes.filter((_, i) => count[i] === min);
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
}

// A body cylinder against the finite firing segment, including vertical clearance.
// Checking the intended shot prevents teammates being used as invisible shields.
export function allyInFireLane(origin, target, actors, shooter) {
  const dx = target.x - origin.x, dz = target.z - origin.z, dy = target.y - origin.y;
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-8) return false;
  for (const a of actors) {
    if (a === shooter || !a.alive || a.team !== shooter.team) continue;
    const t = ((a.pos.x - origin.x) * dx + (a.pos.z - origin.z) * dz) / length2;
    if (t <= 0.01 || t >= 0.99) continue;
    const y = origin.y + dy * t;
    if (y < a.pos.y + 0.04 || y > a.pos.y + (a.height || 1.8) + 0.15) continue;
    const x = origin.x + dx * t - a.pos.x, z = origin.z + dz * t - a.pos.z;
    const radius = (a.radius || 0.36) + 0.20 + Math.sqrt(length2) * t * 0.002;
    if (x * x + z * z < radius * radius) return true;
  }
  return false;
}

export function reachableGoal(nav, x, z) {
  let k = nav.idx(x, z);
  if (k < 0) return null;
  if (!nav.walkable(k)) {
    k = nav.nearestFree(k);
    return k >= 0 ? nav.center(k) : null;
  }
  return [x, z];
}

// Capture points must satisfy the same wall test as the relay rules. A nearby
// navigation cell on the other side of a container does not count as capturing.
export function chooseRelayGoal(bot, objective, angle, preferredRadius) {
  const { nav, world, actors } = bot.game, center = objective.position;
  const limit = Math.max(0.5, (objective.radius || 4.25) - 0.8);
  const preferred = Math.min(preferredRadius, limit);
  const wantedX = center.x + Math.cos(angle) * preferred;
  const wantedZ = center.z + Math.sin(angle) * preferred;
  const candidates = [], seen = new Set();
  for (const radius of [preferred, 0.75, limit]) for (let n = 0; n < 10; n++) {
    const a = angle + n * Math.PI / 5;
    const k = nav.idx(center.x + Math.cos(a) * radius, center.z + Math.sin(a) * radius);
    if (k < 0 || !nav.walkable(k) || seen.has(k)) continue;
    seen.add(k);
    const p = nav.center(k), y = nav.heightAt?.(p[0], p[1]) ?? 0;
    if (Math.abs(y - center.y) > 0.7) continue;
    const dx = center.x - p[0], dz = center.z - p[1], distance = Math.hypot(dx, dz);
    if (distance > limit) continue;
    const dy = center.y - y, rayLength = Math.hypot(distance, dy);
    if (rayLength > 0.2 && world.raycast(p[0], y + 0.8, p[1], dx / rayLength, dy / rayLength, dz / rayLength, rayLength - 0.15, 'sight')) continue;
    let crowd = 0;
    for (const friend of actors) {
      if (friend === bot || !friend.alive || friend.team !== bot.team) continue;
      const q = friend.goal || [friend.pos.x, friend.pos.z];
      crowd += Math.max(0, 1.8 - Math.hypot(p[0] - q[0], p[1] - q[1])) * 1.7;
    }
    const preference = Math.hypot(p[0] - wantedX, p[1] - wantedZ);
    const travel = Math.hypot(p[0] - bot.pos.x, p[1] - bot.pos.z);
    candidates.push({ point: p, score: preference + crowd + travel * 0.08 });
  }
  candidates.sort((a, b) => a.score - b.score);
  // Bounded path tests retain good frame pacing when the relay rotates.
  for (const candidate of candidates.slice(0, 5)) {
    const path = nav.findPath(bot.pos.x, bot.pos.z, candidate.point[0], candidate.point[1]);
    if (path?.length) return { point: candidate.point, path };
  }
  const point = reachableGoal(nav, center.x, center.z);
  if (!point) return null;
  return { point, path: nav.findPath(bot.pos.x, bot.pos.z, point[0], point[1]) };
}

// Search only 30 nearby positions; expensive A* runs on at most the best three.
export function findCover(bot, threat) {
  const { world, nav, actors } = bot.game;
  if (!threat || !nav || !world) return null;
  const options = [], seen = new Set();
  const dangerX = threat.x - bot.pos.x, dangerZ = threat.z - bot.pos.z;
  const dangerDist = Math.hypot(dangerX, dangerZ) || 1;
  const base = Math.atan2(-dangerZ, -dangerX);
  for (const radius of [2.3, 4.5, 7]) for (let n = 0; n < 10; n++) {
    const a = base + n * Math.PI / 5;
    const x = bot.pos.x + Math.cos(a) * radius, z = bot.pos.z + Math.sin(a) * radius;
    const k = nav.idx(x, z);
    if (k < 0 || !nav.walkable(k) || seen.has(k)) continue;
    seen.add(k);
    const p = nav.center(k), y = (nav.heightAt?.(p[0], p[1]) ?? bot.pos.y) + 1.05;
    const dx = threat.x - p[0], dy = (threat.y || 0) + 1.25 - y, dz = threat.z - p[1];
    const L = Math.hypot(dx, dy, dz);
    if (L < 3.0) continue;
    const block = world.raycast(p[0], y, p[1], dx / L, dy / L, dz / L, L - 0.5, 'sight');
    if (!block) continue;
    let crowd = 0;
    for (const friend of actors) if (friend !== bot && friend.alive && friend.team === bot.team) {
      const d = Math.hypot(friend.pos.x - p[0], friend.pos.z - p[1]);
      if (d < 2.3) crowd += (2.3 - d) * 3;
    }
    const closer = Math.max(0, dangerDist - Math.hypot(dx, dz));
    options.push({ point: p, score: radius + closer * 1.7 + crowd });
  }
  options.sort((a, b) => a.score - b.score);
  for (const option of options.slice(0, 3)) {
    const path = nav.findPath(bot.pos.x, bot.pos.z, option.point[0], option.point[1]);
    if (path?.length) return { point: option.point, path };
  }
  return null;
}
