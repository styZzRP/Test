/* =======================================================================
   WASTED CITY — a tiny GTA 2 styled tower defense
   Birds-eye view, retro arcade visuals. Pure vanilla JS + canvas.
   ======================================================================= */

(() => {
  'use strict';

  const TILE = 40;            // pixel size of one city tile
  const COLS = 16;
  const ROWS = 16;
  const W = COLS * TILE;      // 640
  const H = ROWS * TILE;      // 640

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /* ---------------------------------------------------------------------
     THE MAP
     The road is a list of tile waypoints. Cars drive its centre-line from
     the first to the last waypoint. Everything off-road is a buildable lot
     (a city block) where you can deploy a gang.
  --------------------------------------------------------------------- */
  const WAYPOINTS = [
    { c: -1, r: 1 }, { c: 13, r: 1 }, { c: 13, r: 4 }, { c: 2, r: 4 },
    { c: 2, r: 7 }, { c: 13, r: 7 }, { c: 13, r: 10 }, { c: 2, r: 10 },
    { c: 2, r: 13 }, { c: 14, r: 13 }, { c: 14, r: 16 }
  ];

  // Mark which tiles are road so we can render blocks and block building.
  const roadSet = new Set();
  function markRoad() {
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      let a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
      const cc = Math.sign(b.c - a.c), cr = Math.sign(b.r - a.r);
      let c = a.c, r = a.r;
      roadSet.add(c + ',' + r);
      while (c !== b.c || r !== b.r) {
        c += cc; r += cr;
        roadSet.add(c + ',' + r);
      }
    }
  }
  markRoad();
  const isRoad = (c, r) => roadSet.has(c + ',' + r);

  // Pixel-space path (tile centres) for car movement.
  const path = WAYPOINTS.map(w => ({
    x: w.c * TILE + TILE / 2,
    y: w.r * TILE + TILE / 2
  }));

  /* ---------------------------------------------------------------------
     TOWER ("GANG") TYPES
  --------------------------------------------------------------------- */
  const TOWERS = {
    zaibatsu: {
      name: 'Zaibatsu', desc: 'Cheap pistols. Reliable.',
      cost: 50, range: 95, dmg: 8, rate: 0.45, bullet: 4,
      color: '#19e6ff', muzzle: '#bff6ff'
    },
    yakuza: {
      name: 'Yakuza', desc: 'Fast SMG fire.',
      cost: 90, range: 105, dmg: 6, rate: 0.16, bullet: 3,
      color: '#ff2e88', muzzle: '#ffd0e6'
    },
    loonies: {
      name: 'Loonies', desc: 'Heavy, slow, big punch.',
      cost: 140, range: 130, dmg: 34, rate: 1.0, bullet: 7,
      color: '#ffd23f', muzzle: '#fff3c0'
    },
    rednecks: {
      name: 'Rednecks', desc: 'Long range sniper.',
      cost: 170, range: 200, dmg: 26, rate: 0.85, bullet: 5,
      color: '#51ff5b', muzzle: '#d4ffd6'
    }
  };

  /* ---------------------------------------------------------------------
     GAME STATE
  --------------------------------------------------------------------- */
  const state = {
    cash: 220,
    lives: 20,
    wave: 0,
    towers: [],
    enemies: [],
    bullets: [],
    particles: [],
    selectedType: null,
    hoverTile: null,
    spawnQueue: [],
    spawnTimer: 0,
    waveActive: false,
    running: false,
    over: false,
  };

  /* ---------------------------------------------------------------------
     DOM REFS + SHOP
  --------------------------------------------------------------------- */
  const el = {
    cash: document.getElementById('cash'),
    lives: document.getElementById('lives'),
    wave: document.getElementById('wave'),
    towerList: document.getElementById('tower-list'),
    startBtn: document.getElementById('start-wave'),
    hint: document.getElementById('hint'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    overlayBtn: document.getElementById('overlay-btn'),
  };

  function buildShop() {
    el.towerList.innerHTML = '';
    for (const key of Object.keys(TOWERS)) {
      const t = TOWERS[key];
      const card = document.createElement('div');
      card.className = 'tower-card';
      card.dataset.type = key;
      card.innerHTML = `
        <div class="tower-icon" style="background:${t.color}"></div>
        <div>
          <div class="tower-name">${t.name}</div>
          <div class="tower-desc">${t.desc}</div>
        </div>
        <div class="tower-cost">$${t.cost}</div>`;
      card.addEventListener('click', () => selectType(key));
      el.towerList.appendChild(card);
    }
  }

  function selectType(key) {
    if (state.cash < TOWERS[key].cost) return;
    state.selectedType = state.selectedType === key ? null : key;
    refreshShop();
  }

  function refreshShop() {
    for (const card of el.towerList.children) {
      const t = TOWERS[card.dataset.type];
      card.classList.toggle('selected', card.dataset.type === state.selectedType);
      card.classList.toggle('cant', state.cash < t.cost);
    }
  }

  function updateHUD() {
    el.cash.textContent = state.cash;
    el.lives.textContent = state.lives;
    el.wave.textContent = state.wave;
    el.startBtn.disabled = state.waveActive || state.over;
    refreshShop();
  }

  /* ---------------------------------------------------------------------
     INPUT
  --------------------------------------------------------------------- */
  canvas.addEventListener('mousemove', (e) => {
    const { c, r } = tileFromEvent(e);
    state.hoverTile = (c >= 0 && c < COLS && r >= 0 && r < ROWS) ? { c, r } : null;
  });
  canvas.addEventListener('mouseleave', () => state.hoverTile = null);

  canvas.addEventListener('click', (e) => {
    if (!state.selectedType || state.over) return;
    const { c, r } = tileFromEvent(e);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (isRoad(c, r)) { flashHint('Cars drive there — pick an empty lot.'); return; }
    if (state.towers.some(t => t.c === c && t.r === r)) { flashHint('Lot already taken.'); return; }

    const type = TOWERS[state.selectedType];
    if (state.cash < type.cost) { flashHint('Not enough cash.'); return; }

    state.cash -= type.cost;
    state.towers.push({
      c, r, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
      type: state.selectedType, cool: 0, angle: -Math.PI / 2
    });
    if (state.cash < type.cost) state.selectedType = null;
    updateHUD();
  });

  function tileFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    return { c: Math.floor(x / TILE), r: Math.floor(y / TILE) };
  }

  let hintTimer = 0;
  function flashHint(msg) {
    el.hint.textContent = msg;
    hintTimer = 2.5;
  }

  /* ---------------------------------------------------------------------
     WAVES
  --------------------------------------------------------------------- */
  function startWave() {
    if (state.waveActive || state.over) return;
    state.wave++;
    state.waveActive = true;

    const n = 6 + state.wave * 2;
    const baseHp = 24 + state.wave * 14;
    const speed = 42 + state.wave * 2.2;
    state.spawnQueue = [];
    for (let i = 0; i < n; i++) {
      // Every 5th wave rolls in a fat "boss" limo.
      const boss = state.wave % 5 === 0 && i === n - 1;
      state.spawnQueue.push({
        hp: boss ? baseHp * 9 : baseHp * (0.85 + Math.random() * 0.4),
        speed: boss ? speed * 0.6 : speed * (0.9 + Math.random() * 0.3),
        bounty: boss ? 120 : 7 + state.wave,
        boss,
        color: boss ? '#b026ff' : pick(['#c23b22', '#2e7dd1', '#d8d8d8', '#3a3f47', '#caa53d'])
      });
    }
    state.spawnTimer = 0;
    updateHUD();
  }

  el.startBtn.addEventListener('click', startWave);

  function spawnEnemy(def) {
    state.enemies.push({
      x: path[0].x, y: path[0].y,
      seg: 0, t: 0,
      hp: def.hp, maxHp: def.hp,
      speed: def.speed, bounty: def.bounty,
      boss: def.boss, color: def.color,
      angle: 0, wob: Math.random() * 6.28
    });
  }

  /* ---------------------------------------------------------------------
     UPDATE
  --------------------------------------------------------------------- */
  function update(dt) {
    // spawn from queue
    if (state.waveActive && state.spawnQueue.length) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer = 0.7;
      }
    }

    // enemies follow the road
    for (const e of state.enemies) {
      const a = path[e.seg], b = path[e.seg + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      e.t += (e.speed * dt) / len;
      e.angle = Math.atan2(dy, dx);
      if (e.t >= 1) {
        e.t -= 1; e.seg++;
        if (e.seg >= path.length - 1) {
          e.reached = true;
          continue;
        }
      }
      const a2 = path[e.seg], b2 = path[e.seg + 1];
      e.x = a2.x + (b2.x - a2.x) * e.t;
      e.y = a2.y + (b2.y - a2.y) * e.t;
    }

    // enemies that reached the exit cost a life
    for (const e of state.enemies) {
      if (e.reached) {
        state.lives -= e.boss ? 5 : 1;
        screenFlash();
        if (state.lives <= 0) { state.lives = 0; gameOver(); }
      }
    }
    state.enemies = state.enemies.filter(e => !e.reached && e.hp > 0);

    // towers acquire + fire
    for (const tw of state.towers) {
      const cfg = TOWERS[tw.type];
      tw.cool -= dt;
      let target = null, best = -Infinity;
      for (const e of state.enemies) {
        const d = Math.hypot(e.x - tw.x, e.y - tw.y);
        if (d <= cfg.range) {
          // prefer the enemy furthest along the road (closest to exit)
          const prog = e.seg + e.t;
          if (prog > best) { best = prog; target = e; }
        }
      }
      if (target) {
        tw.angle = Math.atan2(target.y - tw.y, target.x - tw.x);
        if (tw.cool <= 0) {
          tw.cool = cfg.rate;
          tw.flash = 0.06;
          state.bullets.push({
            x: tw.x, y: tw.y, target,
            dmg: cfg.dmg, speed: 420, r: cfg.bullet, color: cfg.color
          });
        }
      }
      if (tw.flash) tw.flash -= dt;
    }

    // bullets
    for (const b of state.bullets) {
      if (!b.target || b.target.hp <= 0) { b.dead = true; continue; }
      const dx = b.target.x - b.x, dy = b.target.y - b.y;
      const d = Math.hypot(dx, dy);
      const step = b.speed * dt;
      if (d <= step) {
        b.target.hp -= b.dmg;
        spawnHit(b.target.x, b.target.y, b.color);
        if (b.target.hp <= 0) killEnemy(b.target);
        b.dead = true;
      } else {
        b.x += (dx / d) * step;
        b.y += (dy / d) * step;
      }
    }
    state.bullets = state.bullets.filter(b => !b.dead);

    // particles
    for (const p of state.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
    }
    state.particles = state.particles.filter(p => p.life > 0);

    // wave finished?
    if (state.waveActive && !state.spawnQueue.length && !state.enemies.length) {
      state.waveActive = false;
      state.cash += 40 + state.wave * 8; // end-of-wave payout
      flashHint(`Wave ${state.wave} cleared! +$${40 + state.wave * 8}`);
    }

    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) el.hint.textContent = 'Pick a gang, then click an empty lot to deploy.';
    }
    updateHUD();
  }

  function killEnemy(e) {
    e.hp = 0;
    state.cash += e.bounty;
    for (let i = 0; i < (e.boss ? 24 : 10); i++) spawnHit(e.x, e.y, e.boss ? '#b026ff' : '#ff7a18');
  }

  function spawnHit(x, y, color) {
    state.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 160,
      vy: (Math.random() - 0.5) * 160,
      life: 0.3 + Math.random() * 0.3,
      color
    });
  }

  /* ---------------------------------------------------------------------
     RENDER
  --------------------------------------------------------------------- */
  function render() {
    // ground / city blocks
    drawCity();
    drawRoads();
    drawRange();
    drawTowers();
    drawEnemies();
    drawBullets();
    drawParticles();
    drawHover();
  }

  // Deterministic per-tile pseudo-random so buildings don't flicker.
  function rnd(c, r) {
    let n = (c * 73856093) ^ (r * 19349663);
    n = (n << 13) ^ n;
    return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }

  function drawCity() {
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isRoad(c, r)) continue;
        const x = c * TILE, y = r * TILE;
        const v = rnd(c, r);
        // building block with a darker roof + faux height shadow
        const shade = 26 + Math.floor(v * 26);
        ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        // roof detail
        ctx.fillStyle = `rgba(0,0,0,0.35)`;
        ctx.fillRect(x + 2, y + 2, TILE - 4, 4);
        // little rooftop lights / AC units
        if (v > 0.6) {
          ctx.fillStyle = v > 0.85 ? '#ffd23f' : '#3a4150';
          ctx.fillRect(x + 8 + Math.floor(v * 14), y + 12 + Math.floor(v * 12), 5, 5);
        }
        // edge highlight (sun side)
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x + 2, y + 2, 3, TILE - 4);
      }
    }
  }

  function drawRoads() {
    // asphalt under the whole route
    for (const key of roadSet) {
      const [c, r] = key.split(',').map(Number);
      const x = c * TILE, y = r * TILE;
      ctx.fillStyle = '#26282e';
      ctx.fillRect(x, y, TILE, TILE);
      // subtle asphalt grain
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      if ((c + r) % 2 === 0) ctx.fillRect(x, y, TILE, TILE);
    }
    // dashed yellow centre line along the waypoints
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    // EXIT marker
    const last = path[path.length - 1];
    ctx.fillStyle = '#ff2e88';
    ctx.font = '16px VT323, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', last.x, last.y - 6);
  }

  function drawRange() {
    if (!state.selectedType || !state.hoverTile) return;
    const { c, r } = state.hoverTile;
    if (isRoad(c, r)) return;
    const cfg = TOWERS[state.selectedType];
    const x = c * TILE + TILE / 2, y = r * TILE + TILE / 2;
    ctx.fillStyle = 'rgba(25,230,255,0.08)';
    ctx.strokeStyle = 'rgba(25,230,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, cfg.range, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  function drawTowers() {
    for (const tw of state.towers) {
      const cfg = TOWERS[tw.type];
      // base pad
      ctx.fillStyle = '#0c0d11';
      ctx.fillRect(tw.x - 15, tw.y - 15, 30, 30);
      ctx.fillStyle = '#191c22';
      ctx.fillRect(tw.x - 13, tw.y - 13, 26, 26);
      // turret body
      ctx.save();
      ctx.translate(tw.x, tw.y);
      ctx.rotate(tw.angle);
      ctx.fillStyle = cfg.color;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-8, -8, 16, 4);
      // barrel
      ctx.fillStyle = '#0c0d11';
      ctx.fillRect(4, -3, 16, 6);
      // muzzle flash
      if (tw.flash > 0) {
        ctx.fillStyle = cfg.muzzle;
        ctx.fillRect(18, -4, 8, 8);
      }
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      const w = e.boss ? 34 : 22;
      const h = e.boss ? 18 : 13;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      // tyre shadow
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-w / 2 - 1, -h / 2 + 2, w + 2, h);
      // body
      ctx.fillStyle = e.color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      // roof / windscreen
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-w / 6, -h / 2 + 2, w / 2.2, h - 4);
      // headlights
      ctx.fillStyle = '#fff7c0';
      ctx.fillRect(w / 2 - 2, -h / 2 + 1, 2, 3);
      ctx.fillRect(w / 2 - 2, h / 2 - 4, 2, 3);
      ctx.restore();

      // health bar
      const hpw = w;
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x - hpw / 2, e.y - h / 2 - 7, hpw, 4);
      ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#51ff5b' : '#ff2e88';
      ctx.fillRect(e.x - hpw / 2, e.y - h / 2 - 7, hpw * (e.hp / e.maxHp), 4);
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - b.r / 2, b.y - b.r / 2, b.r, b.r);
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawHover() {
    if (!state.hoverTile || !state.selectedType) return;
    const { c, r } = state.hoverTile;
    const ok = !isRoad(c, r) && !state.towers.some(t => t.c === c && t.r === r);
    ctx.strokeStyle = ok ? '#51ff5b' : '#ff2e88';
    ctx.lineWidth = 2;
    ctx.strokeRect(c * TILE + 2, r * TILE + 2, TILE - 4, TILE - 4);
  }

  /* ---------------------------------------------------------------------
     FX + FLOW
  --------------------------------------------------------------------- */
  function screenFlash() { canvas.classList.add('flash'); setTimeout(() => canvas.classList.remove('flash'), 250); }

  function gameOver() {
    state.over = true;
    state.running = false;
    showOverlay('WASTED', `You survived ${state.wave} wave${state.wave === 1 ? '' : 's'}. The city ate you alive.`, 'TRY AGAIN', resetGame);
  }

  function showOverlay(title, text, btn, cb) {
    el.overlayTitle.textContent = title;
    el.overlayText.textContent = text;
    el.overlayBtn.textContent = btn;
    el.overlay.classList.remove('hidden');
    el.overlayBtn.onclick = () => { el.overlay.classList.add('hidden'); cb(); };
  }

  function resetGame() {
    state.cash = 220; state.lives = 20; state.wave = 0;
    state.towers = []; state.enemies = []; state.bullets = []; state.particles = [];
    state.spawnQueue = []; state.selectedType = null;
    state.waveActive = false; state.over = false; state.running = true;
    updateHUD();
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ---------------------------------------------------------------------
     MAIN LOOP
  --------------------------------------------------------------------- */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.running && !state.over) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------------------
     BOOT
  --------------------------------------------------------------------- */
  buildShop();
  updateHUD();
  showOverlay(
    'WASTED CITY',
    'Top-down gang warfare. Deploy crews on the empty lots and stop the cars before they reach the EXIT. Press a gang in the shop, click a lot, then SEND NEXT WAVE.',
    'HIT THE STREETS',
    () => { state.running = true; }
  );
  requestAnimationFrame(loop);
})();
