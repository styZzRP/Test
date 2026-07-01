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
  const MAPS = [
    {
      name: 'DOWNTOWN',
      waypoints: [
        { c: -1, r: 1 }, { c: 13, r: 1 }, { c: 13, r: 4 }, { c: 2, r: 4 },
        { c: 2, r: 7 }, { c: 13, r: 7 }, { c: 13, r: 10 }, { c: 2, r: 10 },
        { c: 2, r: 13 }, { c: 14, r: 13 }, { c: 14, r: 16 }
      ]
    },
    {
      name: 'THE DOCKS',
      waypoints: [
        { c: 1, r: -1 }, { c: 1, r: 12 }, { c: 5, r: 12 }, { c: 5, r: 3 },
        { c: 10, r: 3 }, { c: 10, r: 14 }, { c: 14, r: 14 }, { c: 14, r: 5 },
        { c: 16, r: 5 }
      ]
    },
    {
      name: 'THE HILLS',
      waypoints: [
        { c: -1, r: 2 }, { c: 6, r: 2 }, { c: 6, r: 6 }, { c: 11, r: 6 },
        { c: 11, r: 2 }, { c: 14, r: 2 }, { c: 14, r: 13 }, { c: 8, r: 13 },
        { c: 8, r: 9 }, { c: 3, r: 9 }, { c: 3, r: 16 }
      ]
    }
  ];

  // Mutable current-map data, rebuilt by loadMap().
  let roadSet = new Set();
  let path = [];

  function loadMap(index) {
    const wps = MAPS[index].waypoints;
    roadSet = new Set();
    for (let i = 0; i < wps.length - 1; i++) {
      let a = wps[i], b = wps[i + 1];
      const cc = Math.sign(b.c - a.c), cr = Math.sign(b.r - a.r);
      let c = a.c, r = a.r;
      roadSet.add(c + ',' + r);
      while (c !== b.c || r !== b.r) {
        c += cc; r += cr;
        roadSet.add(c + ',' + r);
      }
    }
    path = wps.map(w => ({ x: w.c * TILE + TILE / 2, y: w.r * TILE + TILE / 2 }));
  }
  loadMap(0);

  const isRoad = (c, r) => roadSet.has(c + ',' + r);

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
    },
    krishnas: {
      name: 'Krishnas', desc: 'Slows cars in range.',
      cost: 120, range: 115, dmg: 3, rate: 0.5, bullet: 4,
      color: '#ff8a1e', muzzle: '#ffd9a8',
      effect: { type: 'slow', factor: 0.45, dur: 1.3 }
    },
    scientists: {
      name: 'Scientists', desc: 'Rockets — splash damage.',
      cost: 210, range: 150, dmg: 20, rate: 1.35, bullet: 6,
      color: '#7a5cff', muzzle: '#d7ccff',
      effect: { type: 'splash', radius: 52 }
    },
    russians: {
      name: 'Russians', desc: 'Cars blow up — chain reaction.',
      cost: 260, range: 120, dmg: 30, rate: 1.1, bullet: 6,
      color: '#ff4d4d', muzzle: '#ffc2c2',
      effect: { type: 'chain', radius: 62, dmg: 26 }
    }
  };

  const MAX_LEVEL = 5;

  // Effective stats for a placed tower, scaled by its upgrade level.
  function towerStats(tw) {
    const b = TOWERS[tw.type];
    const m = tw.level - 1;
    let effect = b.effect;
    if (effect && effect.type === 'splash') {
      effect = { type: 'splash', radius: effect.radius * (1 + 0.12 * m) };
    } else if (effect && effect.type === 'chain') {
      effect = { type: 'chain', radius: effect.radius * (1 + 0.1 * m), dmg: effect.dmg * Math.pow(1.55, m) };
    }
    return {
      name: b.name,
      range: b.range * (1 + 0.12 * m),
      dmg: b.dmg * Math.pow(1.55, m),
      rate: b.rate * Math.pow(0.85, m),
      bullet: b.bullet + m * 0.6,
      color: b.color, muzzle: b.muzzle,
      effect,
    };
  }

  // Cash needed to take a tower from its current level to the next.
  const upgradeCost = (tw) => Math.round(TOWERS[tw.type].cost * (0.6 + tw.level * 0.35));

  /* ---------------------------------------------------------------------
     GAME STATE
  --------------------------------------------------------------------- */
  const state = {
    cash: 220,
    lives: 20,
    wave: 0,
    score: 0,
    hiscore: Number(localStorage.getItem('wastedcity.hi') || 0),
    towers: [],
    enemies: [],
    bullets: [],
    particles: [],
    blasts: [],            // expanding explosion rings
    selectedType: null,
    selectedTower: null,
    hoverTile: null,
    spawners: [],          // each running wave gets its own concurrent spawner
    waveActive: false,
    running: false,
    over: false,
    speed: 1,              // fast-forward multiplier (1 / 2 / 3)
    mapIndex: 0,
  };

  /* ---------------------------------------------------------------------
     SOUND — tiny Web Audio blips, era-appropriate
  --------------------------------------------------------------------- */
  const Sound = (() => {
    let ctx = null, master = null, enabled = true, lastShoot = 0;
    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    function blip(freq, dur, type = 'square', vol = 1, slideTo = null) {
      if (!enabled || !ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ctx.currentTime + dur);
    }
    return {
      init,
      isOn: () => enabled,
      toggle() { enabled = !enabled; return enabled; },
      shoot() {
        const now = performance.now();
        if (now - lastShoot < 55) return;   // throttle so mass fire isn't noise
        lastShoot = now;
        blip(200 + Math.random() * 60, 0.05, 'square', 0.25);
      },
      explosion() { blip(120, 0.28, 'sawtooth', 0.7, 40); },
      place() { blip(300, 0.08, 'square', 0.5); blip(450, 0.08, 'square', 0.35); },
      upgrade() { blip(440, 0.09, 'square', 0.5); setTimeout(() => blip(660, 0.11, 'square', 0.45), 70); },
      sell() { blip(400, 0.1, 'square', 0.4, 200); },
      waveClear() { blip(523, 0.12, 'square', 0.5); setTimeout(() => blip(784, 0.15, 'square', 0.5), 110); },
      life() { blip(170, 0.22, 'sawtooth', 0.6, 60); },
      over() { blip(220, 0.6, 'sawtooth', 0.7, 45); },
    };
  })();

  /* ---------------------------------------------------------------------
     DOM REFS + SHOP
  --------------------------------------------------------------------- */
  const el = {
    cash: document.getElementById('cash'),
    lives: document.getElementById('lives'),
    wave: document.getElementById('wave'),
    score: document.getElementById('score'),
    mute: document.getElementById('mute'),
    speed: document.getElementById('speed'),
    mapbtn: document.getElementById('mapbtn'),
    towerList: document.getElementById('tower-list'),
    startBtn: document.getElementById('start-wave'),
    hint: document.getElementById('hint'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    overlayBtn: document.getElementById('overlay-btn'),
    towerPanel: document.getElementById('tower-panel'),
    tpTitle: document.getElementById('tp-title'),
    tpStats: document.getElementById('tp-stats'),
    tpUpgrade: document.getElementById('tp-upgrade'),
    tpSell: document.getElementById('tp-sell'),
    tpClose: document.getElementById('tp-close'),
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
    if (state.waveActive) { flashHint('Building is locked until the wave is cleared.'); return; }
    if (state.cash < TOWERS[key].cost) return;
    state.selectedType = state.selectedType === key ? null : key;
    state.selectedTower = null;      // picking a gang closes the upgrade panel
    refreshShop();
    refreshTowerPanel();
  }

  function refreshShop() {
    for (const card of el.towerList.children) {
      const t = TOWERS[card.dataset.type];
      card.classList.toggle('selected', card.dataset.type === state.selectedType);
      // greyed out if too poor, or if a wave is running (can't build mid-wave)
      card.classList.toggle('cant', state.cash < t.cost || state.waveActive);
    }
  }

  // --- Upgrade / sell panel -------------------------------------------------
  function refreshTowerPanel() {
    const tw = state.selectedTower;
    if (!tw) { el.towerPanel.classList.add('hidden'); return; }
    el.towerPanel.classList.remove('hidden');

    const s = towerStats(tw);
    el.tpTitle.textContent = `${s.name}  ·  LVL ${tw.level}/${MAX_LEVEL}`;
    let stats =
      `<span>DMG ${Math.round(s.dmg)}</span>` +
      `<span>RNG ${Math.round(s.range)}</span>` +
      `<span>RATE ${(1 / s.rate).toFixed(1)}/s</span>`;
    if (s.effect && s.effect.type === 'slow') stats += `<span>SLOW</span>`;
    if (s.effect && s.effect.type === 'splash') stats += `<span>SPLASH ${Math.round(s.effect.radius)}</span>`;
    el.tpStats.innerHTML = stats;

    if (tw.level >= MAX_LEVEL) {
      el.tpUpgrade.textContent = 'MAXED';
      el.tpUpgrade.disabled = true;
    } else {
      const cost = upgradeCost(tw);
      el.tpUpgrade.textContent = `UPGRADE $${cost}`;
      el.tpUpgrade.disabled = state.cash < cost;
    }
    el.tpSell.textContent = `SELL $${sellValue(tw)}`;
  }

  const sellValue = (tw) => Math.round(tw.invested * 0.6);

  function upgradeSelected() {
    const tw = state.selectedTower;
    if (!tw || tw.level >= MAX_LEVEL) return;
    const cost = upgradeCost(tw);
    if (state.cash < cost) { flashHint('Not enough cash to upgrade.'); return; }
    state.cash -= cost;
    tw.invested += cost;
    tw.level++;
    Sound.upgrade();
    updateHUD();
    refreshTowerPanel();
  }

  function sellSelected() {
    const tw = state.selectedTower;
    if (!tw) return;
    state.cash += sellValue(tw);
    state.towers = state.towers.filter(t => t !== tw);
    state.selectedTower = null;
    Sound.sell();
    updateHUD();
    refreshTowerPanel();
  }

  function updateHUD() {
    el.cash.textContent = state.cash;
    el.lives.textContent = state.lives;
    el.wave.textContent = state.wave;
    el.score.textContent = state.score;
    // The wave button always works (except on game over) so you can call the
    // next wave in early; its label reflects the early-call bonus.
    el.startBtn.disabled = state.over;
    el.startBtn.textContent = state.waveActive
      ? `SEND WAVE EARLY +$${earlyBonus()}`
      : 'SEND NEXT WAVE';
    refreshShop();
    refreshTowerPanel();
  }

  const earlyBonus = () => 20 + state.wave * 4;

  /* ---------------------------------------------------------------------
     INPUT
  --------------------------------------------------------------------- */
  // --- Mouse (desktop) ---
  canvas.addEventListener('mousemove', (e) => {
    const { c, r } = tileFromPoint(e.clientX, e.clientY);
    state.hoverTile = inBounds(c, r) ? { c, r } : null;
  });
  canvas.addEventListener('mouseleave', () => state.hoverTile = null);
  canvas.addEventListener('click', (e) => {
    if (justTouched) return; // ignore the click browsers synthesise after a tap
    const { c, r } = tileFromPoint(e.clientX, e.clientY);
    handleTap(c, r);
  });

  // --- Touch (iPhone / iPad / Android) ---
  // Dragging a finger previews the range circle; lifting it drops the gang.
  let justTouched = false;
  const onTouch = (e) => {
    if (!e.touches.length) return;
    const t = e.touches[0];
    const { c, r } = tileFromPoint(t.clientX, t.clientY);
    state.hoverTile = inBounds(c, r) ? { c, r } : null;
  };
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onTouch(e); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onTouch(e); }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (state.hoverTile) handleTap(state.hoverTile.c, state.hoverTile.r);
    state.hoverTile = null;
    justTouched = true;              // swallow the trailing synthetic click
    setTimeout(() => justTouched = false, 400);
  }, { passive: false });

  // A tap either selects an existing tower (to upgrade/sell) or, if a gang is
  // picked from the shop, tries to build on the tapped lot.
  function handleTap(c, r) {
    if (state.over || !inBounds(c, r)) return;

    const existing = state.towers.find(t => t.c === c && t.r === r);
    if (existing) {
      state.selectedTower = existing;
      state.selectedType = null;
      updateHUD();
      return;
    }
    if (state.selectedType) { placeTowerAt(c, r); return; }

    // tapped empty ground with nothing selected → clear the panel
    state.selectedTower = null;
    updateHUD();
  }

  function placeTowerAt(c, r) {
    if (!state.selectedType || state.over) return;
    if (!inBounds(c, r)) return;
    if (state.waveActive) { flashHint('Building is locked until the wave is cleared.'); return; }
    if (isRoad(c, r)) { flashHint('Cars drive there — pick an empty lot.'); return; }
    if (state.towers.some(t => t.c === c && t.r === r)) { flashHint('Lot already taken.'); return; }

    const type = TOWERS[state.selectedType];
    if (state.cash < type.cost) { flashHint('Not enough cash.'); return; }

    state.cash -= type.cost;
    state.towers.push({
      c, r, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2,
      type: state.selectedType, level: 1, invested: type.cost,
      cool: 0, angle: -Math.PI / 2
    });
    if (state.cash < type.cost) state.selectedType = null;
    Sound.place();
    updateHUD();
  }

  const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

  function tileFromPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / rect.width);
    const y = (clientY - rect.top) * (H / rect.height);
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
    if (state.over) return;

    // Calling a wave in while the previous one is still running pays a bonus.
    // Each wave gets its OWN spawner, so stacked waves pour cars onto the road
    // at the same time instead of politely queuing single file.
    const early = state.waveActive;
    if (early) { state.cash += earlyBonus(); flashHint(`Wave called in early! +$${earlyBonus()}`); }

    state.wave++;
    state.waveActive = true;

    const n = 6 + state.wave * 2;
    const baseHp = 24 + state.wave * 14;
    const speed = 42 + state.wave * 2.2;
    const queue = [];
    for (let i = 0; i < n; i++) {
      // Every 5th wave rolls in a fat "boss" limo.
      const boss = state.wave % 5 === 0 && i === n - 1;
      queue.push({
        hp: boss ? baseHp * 9 : baseHp * (0.85 + Math.random() * 0.4),
        speed: boss ? speed * 0.6 : speed * (0.9 + Math.random() * 0.3),
        bounty: boss ? 120 : 7 + state.wave,
        boss,
        color: boss ? '#b026ff' : pick(['#c23b22', '#2e7dd1', '#d8d8d8', '#3a3f47', '#caa53d'])
      });
    }
    state.spawners.push({ queue, timer: 0, interval: 0.7 });
    updateHUD();
  }

  el.startBtn.addEventListener('click', startWave);
  el.tpUpgrade.addEventListener('click', upgradeSelected);
  el.tpSell.addEventListener('click', sellSelected);
  el.tpClose.addEventListener('click', () => { state.selectedTower = null; updateHUD(); });

  function spawnEnemy(def) {
    state.enemies.push({
      x: path[0].x, y: path[0].y,
      seg: 0, t: 0,
      hp: def.hp, maxHp: def.hp,
      speed: def.speed, bounty: def.bounty,
      boss: def.boss, color: def.color,
      angle: 0, wob: Math.random() * 6.28,
      slowTimer: 0, slowFactor: 1
    });
  }

  /* ---------------------------------------------------------------------
     UPDATE
  --------------------------------------------------------------------- */
  function update(dt) {
    // Every active wave spawns concurrently — stacked waves = denser traffic.
    for (const sp of state.spawners) {
      sp.timer -= dt;
      if (sp.timer <= 0 && sp.queue.length) {
        spawnEnemy(sp.queue.shift());
        sp.timer = sp.interval;
      }
    }
    state.spawners = state.spawners.filter(sp => sp.queue.length);

    // enemies follow the road
    for (const e of state.enemies) {
      // slow field: cars in a Krishna's range crawl for a moment
      if (e.slowTimer > 0) { e.slowTimer -= dt; } else { e.slowFactor = 1; }
      const spd = e.speed * (e.slowTimer > 0 ? e.slowFactor : 1);

      const a = path[e.seg], b = path[e.seg + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      e.t += (spd * dt) / len;
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
        Sound.life();
        if (state.lives <= 0) { state.lives = 0; gameOver(); }
      }
    }
    state.enemies = state.enemies.filter(e => !e.reached && e.hp > 0);

    // towers acquire + fire
    for (const tw of state.towers) {
      const cfg = towerStats(tw);
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
          Sound.shoot();
          state.bullets.push({
            x: tw.x, y: tw.y, target,
            dmg: cfg.dmg, speed: cfg.effect && cfg.effect.type === 'splash' ? 260 : 420,
            r: cfg.bullet, color: cfg.color, effect: cfg.effect || null
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
        impact(b);
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

    // explosion rings
    for (const bl of state.blasts) {
      bl.r += (bl.max - bl.r) * Math.min(1, dt * 12);
      bl.life -= dt;
    }
    state.blasts = state.blasts.filter(bl => bl.life > 0);

    // wave finished? (all spawners drained and the road is clear)
    if (state.waveActive && !state.spawners.length && !state.enemies.length) {
      state.waveActive = false;
      const payout = 40 + state.wave * 8; // end-of-wave payout
      state.cash += payout;
      Sound.waveClear();
      flashHint(`Wave ${state.wave} cleared! +$${payout}`);
    }

    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) el.hint.textContent = 'Build between waves. Tap a gang to deploy, tap a placed gang to upgrade.';
    }
    updateHUD();
  }

  // Resolve a bullet arriving at its target: direct damage plus any effect.
  function impact(b) {
    const t = b.target;
    const eff = b.effect;
    t.hp -= b.dmg;
    spawnHit(t.x, t.y, b.color);

    if (eff && eff.type === 'slow') applySlow(t, eff);

    if (eff && eff.type === 'splash') {
      Sound.explosion();
      addBlast(t.x, t.y, eff.radius, '#ff9d3a');
      for (let i = 0; i < 14; i++) spawnHit(t.x, t.y, '#ff7a18');
      for (const e of state.enemies) {
        if (e === t) continue;
        const d = Math.hypot(e.x - t.x, e.y - t.y);
        if (d <= eff.radius) {
          e.hp -= b.dmg * 0.6 * (1 - d / eff.radius);
          if (e.hp <= 0) killEnemy(e);
        }
      }
    }

    if (t.hp <= 0) {
      killEnemy(t);
      // chain reaction: a killed car detonates and can set off its neighbours
      if (eff && eff.type === 'chain') chainExplode(t, eff.dmg, eff.radius);
    }
  }

  // Recursive detonation; killEnemy marks cars dead so each blows up once.
  function chainExplode(src, dmg, radius) {
    Sound.explosion();
    addBlast(src.x, src.y, radius, '#ff4d4d');
    for (let i = 0; i < 12; i++) spawnHit(src.x, src.y, '#ff5a3a');
    for (const e of state.enemies) {
      if (e === src || e.dead) continue;
      const d = Math.hypot(e.x - src.x, e.y - src.y);
      if (d <= radius) {
        e.hp -= dmg;
        if (e.hp <= 0 && !e.dead) { killEnemy(e); chainExplode(e, dmg, radius); }
      }
    }
  }

  function addBlast(x, y, radius, color) {
    state.blasts.push({ x, y, r: radius * 0.3, max: radius, life: 0.35, color });
  }

  function applySlow(e, eff) {
    e.slowTimer = Math.max(e.slowTimer, eff.dur);
    e.slowFactor = Math.min(e.slowFactor, eff.factor);
  }

  function killEnemy(e) {
    if (e.hp <= 0 && e.dead) return;    // avoid double-counting splash overkill
    e.dead = true;
    e.hp = 0;
    state.cash += e.bounty;
    state.score += (e.boss ? 250 : 10) + state.wave;
    if (state.score > state.hiscore) {
      state.hiscore = state.score;
      localStorage.setItem('wastedcity.hi', String(state.hiscore));
    }
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
    drawBlasts();
    drawHover();
  }

  // Deterministic per-tile pseudo-random so buildings don't flicker.
  function rnd(c, r) {
    let n = (c * 73856093) ^ (r * 19349663);
    n = (n << 13) ^ n;
    return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }

  const BUILDING_COLORS = ['#2b2f3a', '#343a44', '#2f3942', '#3b3330', '#33402f', '#2c2c34'];

  function drawCity() {
    // grimy ground base
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (isRoad(c, r)) continue;
        const x = c * TILE, y = r * TILE;
        const v = rnd(c, r), v2 = rnd(c + 13, r + 7), v3 = rnd(c + 5, r + 29);

        // pavement under every block
        ctx.fillStyle = '#33363f';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, y, TILE, 1);
        ctx.fillRect(x, y, 1, TILE);

        // some lots are parks / vacant green
        if (v2 > 0.84) { drawPark(x, y, v, v3); continue; }

        const pad = 4;
        const bw = TILE - pad * 2, bh = TILE - pad * 2;

        // fake-height drop shadow (light comes from top-left)
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + pad + 3, y + pad + 3, bw, bh);

        // building body
        const body = BUILDING_COLORS[Math.floor(v * BUILDING_COLORS.length) % BUILDING_COLORS.length];
        ctx.fillStyle = body;
        ctx.fillRect(x + pad, y + pad, bw, bh);
        // lit top-left edges
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(x + pad, y + pad, bw, 2);
        ctx.fillRect(x + pad, y + pad, 2, bh);

        // window grid — some lit
        const gap = 3, cell = 6;
        for (let wy = 0; wy < 3; wy++) {
          for (let wx = 0; wx < 3; wx++) {
            const lit = rnd(c * 7 + wx, r * 7 + wy) > 0.72;
            ctx.fillStyle = lit ? '#ffd98a' : '#14171e';
            ctx.fillRect(x + pad + 3 + wx * (cell + gap), y + pad + 3 + wy * (cell + gap), cell, cell);
          }
        }
        // rooftop unit
        if (v3 > 0.55) {
          ctx.fillStyle = '#20242c';
          ctx.fillRect(x + pad + 2, y + pad + 2, 6, 6);
        }
      }
    }
  }

  function drawPark(x, y, v, v3) {
    ctx.fillStyle = '#1c3a24';
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 3, y + 3, TILE - 6, 2);
    // a couple of trees
    const trees = v3 > 0.5 ? 3 : 2;
    for (let i = 0; i < trees; i++) {
      const tx = x + 8 + ((i * 11 + Math.floor(v * 9)) % (TILE - 16));
      const ty = y + 9 + ((i * 13 + Math.floor(v3 * 11)) % (TILE - 18));
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(tx - 3, ty - 2, 8, 8);
      ctx.fillStyle = '#2e6b38';
      ctx.fillRect(tx - 4, ty - 4, 8, 8);
      ctx.fillStyle = '#3e8a48';
      ctx.fillRect(tx - 4, ty - 4, 4, 4);
    }
  }

  function drawRoads() {
    // asphalt + curbs
    for (const key of roadSet) {
      const [c, r] = key.split(',').map(Number);
      const x = c * TILE, y = r * TILE;
      ctx.fillStyle = '#1e2025';
      ctx.fillRect(x, y, TILE, TILE);
      // grain
      if ((c + r) % 2 === 0) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y, TILE, TILE); }
      // oil stain
      if (rnd(c + 3, r + 11) > 0.8) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + 12, y + 14, 12, 9);
      }
      // curbs where a neighbour is NOT road (kerb line at the pavement edge)
      ctx.fillStyle = '#4a4e58';
      if (!isRoad(c, r - 1)) ctx.fillRect(x, y, TILE, 2);
      if (!isRoad(c, r + 1)) ctx.fillRect(x, y + TILE - 2, TILE, 2);
      if (!isRoad(c - 1, r)) ctx.fillRect(x, y, 2, TILE);
      if (!isRoad(c + 1, r)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
    }

    // dashed yellow centre line along the route
    ctx.strokeStyle = '#e9c33a';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '16px VT323, monospace';
    ctx.textAlign = 'center';
    // START marker (spawn)
    const first = path[0];
    ctx.fillStyle = '#19e6ff';
    ctx.fillText('START', clampX(first.x), clampY(first.y) + 4);
    // EXIT marker
    const last = path[path.length - 1];
    ctx.fillStyle = '#ff2e88';
    ctx.fillText('EXIT', clampX(last.x), clampY(last.y) - 4);
  }

  const clampX = (x) => Math.max(20, Math.min(W - 20, x));
  const clampY = (y) => Math.max(16, Math.min(H - 8, y));

  function drawRange() {
    // range of a placed tower that's selected for upgrade
    if (state.selectedTower) {
      const tw = state.selectedTower;
      ctx.fillStyle = 'rgba(255,210,63,0.08)';
      ctx.strokeStyle = 'rgba(255,210,63,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(tw.x, tw.y, towerStats(tw).range, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    // range preview while placing a new gang
    if (state.selectedType && state.hoverTile) {
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
  }

  function drawTowers() {
    for (const tw of state.towers) {
      const cfg = towerStats(tw);
      const base = TOWERS[tw.type];

      // selection highlight
      if (tw === state.selectedTower) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2;
        ctx.strokeRect(tw.c * TILE + 2, tw.r * TILE + 2, TILE - 4, TILE - 4);
      }

      // soft gang-coloured glow
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = base.color;
      ctx.beginPath(); ctx.arc(tw.x, tw.y, 17, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // concrete base pad with coloured trim
      ctx.fillStyle = '#0c0d11';
      ctx.fillRect(tw.x - 14, tw.y - 14, 28, 28);
      ctx.fillStyle = '#20242c';
      ctx.fillRect(tw.x - 12, tw.y - 12, 24, 24);
      ctx.fillStyle = base.color;
      // corner bolts in gang colour
      ctx.fillRect(tw.x - 12, tw.y - 12, 3, 3);
      ctx.fillRect(tw.x + 9, tw.y - 12, 3, 3);
      ctx.fillRect(tw.x - 12, tw.y + 9, 3, 3);
      ctx.fillRect(tw.x + 9, tw.y + 9, 3, 3);

      // rotating turret
      ctx.save();
      ctx.translate(tw.x, tw.y);
      ctx.rotate(tw.angle);
      // barrel — grows with level; wide nozzle for slow, tube for splash/chain
      const bl = 15 + (tw.level - 1) * 2;
      ctx.fillStyle = '#0a0b0e';
      const bw = base.effect && base.effect.type === 'slow' ? 8 : 6;
      ctx.fillRect(3, -bw / 2, bl, bw);
      if (base.effect && (base.effect.type === 'splash' || base.effect.type === 'chain')) {
        ctx.fillStyle = base.color;                 // rocket tip
        ctx.fillRect(3 + bl - 3, -bw / 2, 3, bw);
      }
      // dome
      ctx.fillStyle = cfg.color;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(-2, -2, 3, 0, Math.PI * 2); ctx.fill();
      // muzzle flash
      if (tw.flash > 0) {
        ctx.fillStyle = cfg.muzzle;
        ctx.beginPath(); ctx.arc(3 + bl + 3, 0, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();

      // upgrade level pips
      for (let i = 0; i < tw.level - 1; i++) {
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(tw.x - 12 + i * 6, tw.y + 10, 4, 3);
      }
    }
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * f)) | 0;
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * f)) | 0;
    const b = Math.max(0, Math.min(255, (n & 255) * f)) | 0;
    return `rgb(${r},${g},${b})`;
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      const w = e.boss ? 36 : 22;
      const h = e.boss ? 17 : 12;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);

      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(-w / 2, -h / 2 + 3, w, h);

      // wheels
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(-w / 2 + 2, -h / 2 - 1, 5, 3);
      ctx.fillRect(w / 2 - 7, -h / 2 - 1, 5, 3);
      ctx.fillRect(-w / 2 + 2, h / 2 - 2, 5, 3);
      ctx.fillRect(w / 2 - 7, h / 2 - 2, 5, 3);

      // body with light/dark sides
      ctx.fillStyle = e.color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = shade(e.color, 1.25);
      ctx.fillRect(-w / 2, -h / 2, w, 2);           // sunlit top
      ctx.fillStyle = shade(e.color, 0.6);
      ctx.fillRect(-w / 2, h / 2 - 2, w, 2);         // shaded bottom

      // cabin / windscreen (tinted glass)
      ctx.fillStyle = '#11202b';
      if (e.boss) {
        ctx.fillRect(-w / 2 + 6, -h / 2 + 2, w - 14, h - 4);
        ctx.fillStyle = '#0a1319';
        ctx.fillRect(0, -h / 2 + 2, 2, h - 4);        // limo divider
      } else {
        ctx.fillRect(-2, -h / 2 + 2, w / 2.6, h - 4);
      }

      // headlights (front) + tail lights (rear)
      ctx.fillStyle = '#fff7c0';
      ctx.fillRect(w / 2 - 2, -h / 2 + 1, 2, 3);
      ctx.fillRect(w / 2 - 2, h / 2 - 4, 2, 3);
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(-w / 2, -h / 2 + 1, 1.5, 3);
      ctx.fillRect(-w / 2, h / 2 - 4, 1.5, 3);

      // frost overlay when slowed
      if (e.slowTimer > 0) {
        ctx.fillStyle = 'rgba(120,200,255,0.35)';
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      ctx.restore();

      // health bar
      const hpw = w;
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x - hpw / 2, e.y - h / 2 - 8, hpw, 4);
      ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#51ff5b' : '#ff2e88';
      ctx.fillRect(e.x - hpw / 2, e.y - h / 2 - 8, hpw * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      const rocket = b.effect && (b.effect.type === 'splash' || b.effect.type === 'chain');
      if (rocket) {
        // rocket with a little flame tail
        ctx.fillStyle = '#ffb648';
        ctx.fillRect(b.x - 3, b.y - 2, 3, 4);
      }
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r / 1.6 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, Math.max(1, b.r / 4), 0, Math.PI * 2);
      ctx.fill();
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

  function drawBlasts() {
    for (const bl of state.blasts) {
      const a = Math.max(0, bl.life / 0.35);
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = bl.color;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a;
      ctx.strokeStyle = bl.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2); ctx.stroke();
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
    Sound.over();
    const hi = state.score >= state.hiscore;
    showOverlay(
      'WASTED',
      `Score ${state.score}${hi ? ' — NEW HIGH SCORE!' : ` (best ${state.hiscore})`}. ` +
      `You survived ${state.wave} wave${state.wave === 1 ? '' : 's'}.`,
      'TRY AGAIN', resetGame);
  }

  function showOverlay(title, text, btn, cb) {
    el.overlayTitle.textContent = title;
    el.overlayText.textContent = text;
    el.overlayBtn.textContent = btn;
    el.overlay.classList.remove('hidden');
    el.overlayBtn.onclick = () => { el.overlay.classList.add('hidden'); cb(); };
  }

  function resetGame() {
    state.cash = 220; state.lives = 20; state.wave = 0; state.score = 0;
    state.towers = []; state.enemies = []; state.bullets = []; state.particles = [];
    state.blasts = []; state.spawners = []; state.selectedType = null; state.selectedTower = null;
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
    if (state.running && !state.over) {
      // fast-forward runs the sim in extra sub-steps for stability
      for (let i = 0; i < state.speed; i++) update(dt);
    }
    render();
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------------------
     BOOT
  --------------------------------------------------------------------- */
  // Mute toggle
  el.mute.addEventListener('click', () => {
    Sound.init();
    const on = Sound.toggle();
    el.mute.innerHTML = on ? '&#128266;' : '&#128263;';
    el.mute.classList.toggle('off', !on);
  });

  // Fast-forward: cycle 1x -> 2x -> 3x
  el.speed.addEventListener('click', () => {
    state.speed = state.speed >= 3 ? 1 : state.speed + 1;
    el.speed.innerHTML = `&#9654; ${state.speed}x`;
  });

  // Switch map (resets the board onto the next city)
  el.mapbtn.addEventListener('click', () => {
    if (state.waveActive) { flashHint('Clear the wave before switching maps.'); return; }
    state.mapIndex = (state.mapIndex + 1) % MAPS.length;
    loadMap(state.mapIndex);
    resetGame();
    flashHint(`Map: ${MAPS[state.mapIndex].name}`);
  });

  buildShop();
  updateHUD();
  showOverlay(
    'WASTED CITY',
    'Top-down gang warfare across 3 cities. Build & upgrade crews between waves — Krishnas slow cars, Scientists splash, Russians chain-explode them. Use the ▶ button to fast-forward and MAP ▸ to switch city. Stop the traffic before the EXIT!',
    'HIT THE STREETS',
    () => { Sound.init(); state.running = true; }   // first gesture unlocks audio
  );
  requestAnimationFrame(loop);
})();
