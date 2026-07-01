/* =======================================================================
   EchoWeave — a spatial-logic / time-editing puzzle prototype.

   You control one character in a small room. Every 8 seconds your recorded
   actions become an ECHO that replays alongside you. The timeline at the
   bottom lists the events those echoes cause (a switch pressed, a laser
   tripped...). You may ERASE up to two events; the whole room then
   re-derives its causality — doors, lasers and echoes all react.

   This slice ships: player, echoes, pressure & latch switches, doors,
   lasers and the goal crystal. Mirrors / blocks / "move event" are future
   worlds. The simulation is fully deterministic so erasing an event simply
   re-runs history.
   ======================================================================= */

(() => {
  'use strict';

  const TICK_RATE = 8;              // simulation steps per second
  const TICK_DT = 1 / TICK_RATE;
  const CYCLE_TICKS = 8 * TICK_RATE; // 8 second memory
  const MAX_ECHOES = 5;
  const MAX_ERASE = 2;

  const PLATE_COLORS = {
    A: '#7ff0ff', B: '#ff7a9c', C: '#ffd479', D: '#8affa0', E: '#c08bff'
  };
  const PLATE_GLYPH = { A: '◇', B: '◇', C: '◇', D: '◇', E: '◇' };

  /* ---------------------------------------------------------------------
     LEVELS
     Grid chars: '#' wall, '.' floor, 'P' spawn, 'G' goal crystal,
     'A'..'E' switches, 'a'..'e' doors, '~' laser beam cell.
  --------------------------------------------------------------------- */
  const LEVELS = [
    {
      name: 'De eerste echo',
      hint: 'Een deur gaat alleen open zolang iemand op de plaat staat. ' +
            'Sta erop, weef een echo, en laat je echo de plaat bezet houden ' +
            'terwijl jij naar het kristal loopt.',
      rows: [
        '###########',
        '#P........#',
        '#.........#',
        '#...A.....#',
        '#####a#####',
        '#.........#',
        '#....G....#',
        '#.........#',
        '###########',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: {},
    },
    {
      name: 'Onthouden is optioneel',
      hint: 'Onderweg naar de plaat stap je op de rode plaat — die schakelt ' +
            'de laser in en verspert het kristal. Weef een echo, en WIS daarna ' +
            'de rode gebeurtenis zodat de laser nooit aanging.',
      rows: [
        '#############',
        '#P..........#',
        '#...........#',
        '#..B.....A..#',
        '######a######',
        '#~~~~~~~~~~~#',
        '#...........#',
        '#.....G.....#',
        '#############',
      ],
      plates: { A: { kind: 'pressure' }, B: { kind: 'latch' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: { L: { controllers: [{ plate: 'B' }] } },
    },
    {
      name: 'Twee waarheden',
      hint: 'De gele plaat sluit de deur (latch) zodra iemand hem raakt. ' +
            'De blauwe plaat opent hem. Beslis welke gebeurtenis uit de ' +
            'geschiedenis moet verdwijnen.',
      rows: [
        '#############',
        '#P....C.....#',
        '#.....#.....#',
        '#..A..#.....#',
        '####a########',
        '#...........#',
        '#.....G.....#',
        '#############',
      ],
      plates: { A: { kind: 'pressure' }, C: { kind: 'latch' } },
      // A opens the door; the C latch, once touched, forces it shut.
      doors: { a: { controllers: [{ plate: 'A' }, { plate: 'C', close: true }] } },
      lasers: {},
    },
  ];

  /* ---------------------------------------------------------------------
     LEVEL PARSING
  --------------------------------------------------------------------- */
  function parseLevel(def) {
    const H = def.rows.length, W = def.rows[0].length;
    const walls = [];
    let spawn = null, goal = null;
    const plateCells = {}, doorCells = {}, laserCells = [];

    for (let y = 0; y < H; y++) {
      walls[y] = [];
      for (let x = 0; x < W; x++) {
        const ch = def.rows[y][x];
        walls[y][x] = ch === '#';
        if (ch === 'P') spawn = { x, y };
        else if (ch === 'G') goal = { x, y };
        else if (ch >= 'A' && ch <= 'E') plateCells[ch] = { x, y };
        else if (ch >= 'a' && ch <= 'e') doorCells[ch] = { x, y };
        else if (ch === '~') laserCells.push({ x, y });
      }
    }

    const plates = {};
    for (const id in def.plates) {
      plates[id] = {
        id, ...def.plates[id], ...plateCells[id],
        color: PLATE_COLORS[id] || '#ffffff',
      };
    }
    const doors = {};
    for (const id in def.doors) {
      doors[id] = { id, ...def.doors[id], ...doorCells[id] };
    }
    const lasers = {};
    for (const id in def.lasers) {
      lasers[id] = { id, ...def.lasers[id], cells: laserCells };
    }

    return { name: def.name, hint: def.hint, W, H, walls, spawn, goal, plates, doors, lasers };
  }

  /* ---------------------------------------------------------------------
     GAME STATE
  --------------------------------------------------------------------- */
  const DIRS = [ {x:0,y:0}, {x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0} ]; // 0 wait,U,D,L,R

  const G = {
    levelIndex: 0,
    level: null,
    echoes: [],          // { id, track:[dir], spawn }
    live: null,          // { id:'live', track:[], pos, prev, spawn }
    suppressed: new Set(),// keys `${actorId}|${plateId}`
    tick: 0,
    acc: 0,
    running: false,
    won: false,
    events: [],          // timeline events (from echo-only sim)
    breathe: 0,          // erase animation
    selectedEvent: null,
    input: 0,            // current sampled direction
    world: null,         // live world object states
  };

  /* ---------------------------------------------------------------------
     SIMULATION CORE
     A "world" tracks door/laser/latch state. objectsFromPositions() derives
     it from where the actors currently stand (respecting suppression).
  --------------------------------------------------------------------- */
  function freshWorld() {
    const w = { doorOpen: {}, laserOn: {}, latched: {}, occ: {} };
    for (const id in G.level.doors) w.doorOpen[id] = false;
    for (const id in G.level.lasers) w.laserOn[id] = false;
    for (const id in G.level.plates) { w.latched[id] = false; w.occ[id] = new Set(); }
    return w;
  }

  const key = (actorId, plateId) => actorId + '|' + plateId;

  // Which actors (by id) currently occupy each plate, ignoring suppressed echoes.
  function computeOccupancy(positions) {
    const occ = {};
    for (const id in G.level.plates) occ[id] = new Set();
    for (const p of positions) {
      for (const id in G.level.plates) {
        const pl = G.level.plates[id];
        if (p.x === pl.x && p.y === pl.y) {
          if (p.actorId !== 'live' && G.suppressed.has(key(p.actorId, id))) continue;
          occ[id].add(p.actorId);
        }
      }
    }
    return occ;
  }

  // Update latches on rising edges, then derive doors & lasers.
  function deriveWorld(world, occ) {
    for (const id in G.level.plates) {
      const pl = G.level.plates[id];
      const now = occ[id].size > 0;
      const before = world.occ[id].size > 0;
      if (pl.kind === 'latch' && now && !before) world.latched[id] = !world.latched[id];
      world.occ[id] = occ[id];
    }
    const active = (id) => {
      const pl = G.level.plates[id];
      return pl.kind === 'latch' ? world.latched[id] : world.occ[id].size > 0;
    };
    for (const id in G.level.doors) {
      const d = G.level.doors[id];
      let open = false;
      // opening controllers (OR); a plate can be inverted (open while NOT active)
      for (const c of (d.controllers || [])) {
        if (c.close) continue;
        if (active(c.plate) !== !!c.invert) open = true;
      }
      // closing controllers override: if active, force the door shut
      for (const c of (d.controllers || [])) {
        if (c.close && active(c.plate)) open = false;
      }
      world.doorOpen[id] = open;
    }
    for (const id in G.level.lasers) {
      const l = G.level.lasers[id];
      let on = false;
      for (const c of (l.controllers || [])) if (active(c.plate) !== !!c.invert) on = true;
      world.laserOn[id] = on;
    }
    return world;
  }

  function passable(x, y, world) {
    const L = G.level;
    if (x < 0 || y < 0 || x >= L.W || y >= L.H) return false;
    if (L.walls[y][x]) return false;
    for (const id in L.doors) {
      const d = L.doors[id];
      if (d.x === x && d.y === y && !world.doorOpen[id]) return false;
    }
    for (const id in L.lasers) {
      if (!world.laserOn[id]) continue;
      for (const c of L.lasers[id].cells) if (c.x === x && c.y === y) return false;
    }
    return true;
  }

  // Advance all actors one tick given their direction; mutates positions + world.
  function stepTick(positions, dirs, world) {
    // move using the world state as it currently stands
    for (const p of positions) {
      const d = DIRS[dirs[p.actorId] || 0];
      const nx = p.x + d.x, ny = p.y + d.y;
      p.prevX = p.x; p.prevY = p.y;
      if ((d.x || d.y) && passable(nx, ny, world)) { p.x = nx; p.y = ny; }
    }
    // re-derive world from the new positions
    deriveWorld(world, computeOccupancy(positions));
  }

  /* ---------------------------------------------------------------------
     EVENT TIMELINE — computed by simulating echoes only (deterministic)
  --------------------------------------------------------------------- */
  function computeEvents() {
    const events = [];
    if (!G.echoes.length) { G.events = events; return; }
    const world = freshWorld();
    const positions = G.echoes.map(e => ({ actorId: e.id, x: e.spawn.x, y: e.spawn.y }));
    deriveWorld(world, computeOccupancy(positions));
    const onPlate = {}; // actorId+plate -> currently on

    for (let t = 0; t < CYCLE_TICKS; t++) {
      const dirs = {};
      for (const e of G.echoes) dirs[e.id] = e.track[t] || 0;
      stepTick(positions, dirs, world);
      for (const p of positions) {
        for (const id in G.level.plates) {
          const pl = G.level.plates[id];
          const on = (p.x === pl.x && p.y === pl.y);
          const k = p.actorId + id;
          if (on && !onPlate[k]) {
            events.push({
              id: p.actorId + ':' + id + ':' + t,
              actorId: p.actorId, plateId: id, tick: t,
              color: pl.color, anchored: !!pl.anchored,
            });
          }
          onPlate[k] = on;
        }
      }
    }
    events.sort((a, b) => a.tick - b.tick);
    G.events = events;
  }

  /* ---------------------------------------------------------------------
     LIVE LOOP
  --------------------------------------------------------------------- */
  function loadLevel(i) {
    G.levelIndex = i;
    G.level = parseLevel(LEVELS[i]);
    resetCycle(true);
    G.won = false;
    computeEvents();
    renderTimeline();
    renderHUD();
    showOverlay('LEVEL ' + (i + 1), G.level.hint, 'START', () => { G.running = true; });
  }

  function resetCycle(fullReset) {
    if (fullReset) {
      G.echoes = [];
      G.suppressed = new Set();
    }
    G.tick = 0; G.acc = 0;
    G.live = { id: 'live', track: [], spawn: G.level.spawn };
    G.world = freshWorld();
    // place all actors at spawn
    positionsInit();
    deriveWorld(G.world, computeOccupancy(currentPositions()));
    renderHUD();
  }

  let POS = [];
  function positionsInit() {
    POS = [];
    for (const e of G.echoes)
      POS.push({ actorId: e.id, x: e.spawn.x, y: e.spawn.y, prevX: e.spawn.x, prevY: e.spawn.y });
    POS.push({ actorId: 'live', x: G.live.spawn.x, y: G.live.spawn.y, prevX: G.live.spawn.x, prevY: G.live.spawn.y });
  }
  const currentPositions = () => POS;
  const posOf = (id) => POS.find(p => p.actorId === id);

  function doTick() {
    const dirs = {};
    for (const e of G.echoes) dirs[e.id] = e.track[G.tick] || 0;
    dirs['live'] = G.input;
    G.live.track[G.tick] = G.input;

    stepTick(POS, dirs, G.world);
    G.tick++;

    // win: the live player reached the crystal
    const lp = posOf('live');
    if (lp && lp.x === G.level.goal.x && lp.y === G.level.goal.y) { winLevel(); return; }

    if (G.tick >= CYCLE_TICKS) endCycle();
  }

  function endCycle() {
    // finalise the live recording into an echo (pad track to full length)
    for (let t = 0; t < CYCLE_TICKS; t++) if (G.live.track[t] == null) G.live.track[t] = 0;
    if (G.echoes.length < MAX_ECHOES) {
      G.echoes.push({ id: 'echo' + (G.echoes.length + 1), track: G.live.track.slice(), spawn: G.level.spawn });
    } else {
      flashTitle('Max echoes bereikt — herstart (↺)');
    }
    resetCycle(false);
    computeEvents();
    renderTimeline();
  }

  function weaveNow() {
    if (!G.running || G.won) return;
    // pad the rest of the cycle with waits and end it
    for (let t = G.tick; t < CYCLE_TICKS; t++) G.live.track[t] = 0;
    endCycle();
  }

  function winLevel() {
    G.won = true; G.running = false;
    Sound.win();
    const last = G.levelIndex >= LEVELS.length - 1;
    showOverlay('OPGELOST', last
      ? 'Je hebt alle kamers herschreven. Meer werelden (spiegels, blokken, verplaatsen van tijd) komen eraan.'
      : 'De tijdlijn klopt. De kamer ademt uit.',
      last ? 'OPNIEUW' : 'VOLGENDE', () => {
        loadLevel(last ? 0 : G.levelIndex + 1);
      });
  }

  /* ---------------------------------------------------------------------
     ERASING
  --------------------------------------------------------------------- */
  function eraseCount() {
    return new Set([...G.suppressed]).size;
  }

  function toggleErase(ev) {
    const k = key(ev.actorId, ev.plateId);
    if (G.suppressed.has(k)) {
      G.suppressed.delete(k);
    } else {
      if (ev.anchored) { flashTitle('Deze gebeurtenis is verankerd'); return; }
      if (eraseCount() >= MAX_ERASE) { flashTitle('Maximaal ' + MAX_ERASE + ' wissen'); return; }
      G.suppressed.add(k);
    }
    G.breathe = 1;
    Sound.erase();
    // Editing history rewinds the room: replay this cycle from t=0 with the
    // new causality (latches, lasers and echoes all rederive from scratch).
    resetCycle(false);
    computeEvents();
    renderHUD();
    renderTimeline();
  }

  /* ---------------------------------------------------------------------
     SOUND — sparse glassy ticks & synths
  --------------------------------------------------------------------- */
  const Sound = (() => {
    let ctx = null, master = null, on = true;
    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC(); master = ctx.createGain();
      master.gain.value = 0.3; master.connect(ctx.destination);
    }
    function tone(f, dur, type = 'sine', vol = 0.5, slide = null) {
      if (!on || !ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, ctx.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
    }
    return {
      init,
      tick() { tone(880 + Math.random() * 40, 0.05, 'sine', 0.08); },
      weave() { tone(300, 0.4, 'sine', 0.3, 600); },
      erase() { tone(520, 0.5, 'triangle', 0.35, 180); tone(1040, 0.4, 'sine', 0.15); },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.3), i * 130)); },
    };
  })();

  /* ---------------------------------------------------------------------
     RENDER
  --------------------------------------------------------------------- */
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  function layout() {
    const L = G.level;
    const pad = 24;
    const cw = canvas.width - pad * 2, ch = canvas.height - pad * 2;
    const cell = Math.floor(Math.min(cw / L.W, ch / L.H));
    const ox = (canvas.width - cell * L.W) / 2;
    const oy = (canvas.height - cell * L.H) / 2;
    return { cell, ox, oy };
  }

  function render() {
    const L = G.level;
    if (!L) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { cell, ox, oy } = layout();
    const alpha = Math.min(1, G.acc / TICK_DT);

    // breathe: a gentle scale pulse around the room centre
    const br = G.breathe > 0 ? Math.sin(G.breathe * Math.PI) * 0.012 : 0;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(1 + br, 1 + br);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);

    // floor grid
    for (let y = 0; y < L.H; y++) {
      for (let x = 0; x < L.W; x++) {
        const px = ox + x * cell, py = oy + y * cell;
        if (L.walls[y][x]) {
          roundRect(px + 2, py + 2, cell - 4, cell - 4, 6);
          ctx.fillStyle = 'rgba(40,54,110,0.55)';
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(150,170,255,0.08)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        }
      }
    }

    // plates
    for (const id in L.plates) {
      const pl = L.plates[id];
      const active = pl.kind === 'latch' ? G.world.latched[id] : G.world.occ[id].size > 0;
      drawPlate(ox + pl.x * cell, oy + pl.y * cell, cell, pl.color, active, pl.kind === 'latch');
    }

    // doors
    for (const id in L.doors) {
      const d = L.doors[id];
      drawDoor(ox + d.x * cell, oy + d.y * cell, cell, G.world.doorOpen[id]);
    }

    // lasers
    for (const id in L.lasers) {
      if (!G.world.laserOn[id]) continue;
      for (const c of L.lasers[id].cells) drawLaser(ox + c.x * cell, oy + c.y * cell, cell);
    }

    // goal crystal
    drawCrystal(ox + (L.goal.x + 0.5) * cell, oy + (L.goal.y + 0.5) * cell, cell);

    // echoes then player
    for (const p of POS) {
      if (p.actorId === 'live') continue;
      const rx = ox + (lerp(p.prevX, p.x, alpha) + 0.5) * cell;
      const ry = oy + (lerp(p.prevY, p.y, alpha) + 0.5) * cell;
      drawActor(rx, ry, cell, true);
    }
    const lp = posOf('live');
    if (lp) {
      const rx = ox + (lerp(lp.prevX, lp.x, alpha) + 0.5) * cell;
      const ry = oy + (lerp(lp.prevY, lp.y, alpha) + 0.5) * cell;
      drawActor(rx, ry, cell, false);
    }

    ctx.restore();
  }

  function drawActor(x, y, cell, isEcho) {
    const r = cell * 0.3;
    ctx.save();
    ctx.shadowBlur = 18; ctx.shadowColor = isEcho ? '#7ff0ff' : '#eaf0ff';
    ctx.globalAlpha = isEcho ? 0.55 : 1;
    ctx.fillStyle = isEcho ? 'rgba(127,240,255,0.5)' : '#eaf0ff';
    roundRect(x - r, y - r, r * 2, r * 2, r * 0.5); ctx.fill();
    ctx.restore();
  }

  function drawPlate(px, py, cell, color, active, latch) {
    const cx = px + cell / 2, cy = py + cell / 2, r = cell * 0.3;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.shadowBlur = active ? 16 : 4; ctx.shadowColor = color;
    ctx.globalAlpha = active ? 1 : 0.55;
    ctx.beginPath();
    if (latch) { ctx.rect(cx - r, cy - r, r * 2, r * 2); }
    else { ctx.arc(cx, cy, r, 0, Math.PI * 2); }
    ctx.stroke();
    if (active) { ctx.globalAlpha = 0.25; ctx.fillStyle = color; ctx.fill(); }
    ctx.restore();
  }

  function drawDoor(px, py, cell, open) {
    ctx.save();
    ctx.strokeStyle = '#eaf0ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.shadowBlur = 8; ctx.shadowColor = '#eaf0ff';
    ctx.globalAlpha = open ? 0.18 : 1;
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.2, py + cell * 0.5);
    ctx.lineTo(px + cell * 0.8, py + cell * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawLaser(px, py, cell) {
    ctx.save();
    ctx.strokeStyle = '#ff7a9c'; ctx.lineWidth = 3;
    ctx.shadowBlur = 14; ctx.shadowColor = '#ff7a9c';
    ctx.beginPath();
    ctx.moveTo(px, py + cell / 2); ctx.lineTo(px + cell, py + cell / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrystal(cx, cy, cell) {
    const r = cell * 0.26;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t * 0.6);
    ctx.shadowBlur = 20; ctx.shadowColor = '#ffd479';
    ctx.strokeStyle = '#ffd479'; ctx.fillStyle = 'rgba(255,212,121,0.18)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------------------------------------------------------------------
     HUD + TIMELINE DOM
  --------------------------------------------------------------------- */
  const el = {
    levelNum: document.getElementById('level-num'),
    levelName: document.getElementById('level-name'),
    echoDots: document.getElementById('echo-dots'),
    eraseCount: document.getElementById('erase-count'),
    ringFg: document.getElementById('ring-fg'),
    timeline: document.getElementById('timeline'),
    overlay: document.getElementById('overlay'),
    ovTitle: document.getElementById('ov-title'),
    ovText: document.getElementById('ov-text'),
    ovBtn: document.getElementById('ov-btn'),
    menu: document.getElementById('event-menu'),
  };
  const RING_LEN = 2 * Math.PI * 15.5;
  el.ringFg.style.strokeDasharray = RING_LEN;

  function renderHUD() {
    el.levelNum.textContent = G.levelIndex + 1;
    el.levelName.textContent = G.level.name;
    let dots = '';
    for (let i = 0; i < MAX_ECHOES; i++) dots += `<i class="${i < G.echoes.length ? 'on' : ''}"></i>`;
    el.echoDots.innerHTML = dots;
    el.eraseCount.textContent = eraseCount() + '/' + MAX_ERASE;
  }

  function renderRing() {
    const frac = G.running ? G.tick / CYCLE_TICKS : 0;
    el.ringFg.style.strokeDashoffset = RING_LEN * (1 - frac);
  }

  function renderTimeline() {
    el.timeline.innerHTML = '';
    for (const ev of G.events) {
      const suppressed = G.suppressed.has(key(ev.actorId, ev.plateId));
      const div = document.createElement('div');
      div.className = 'ev' + (suppressed ? ' erased' : '') + (ev.anchored ? ' anchored' : '') +
        (G.selectedEvent === ev.id ? ' sel' : '');
      div.style.color = ev.color;
      div.innerHTML = `<span class="glyph">${PLATE_GLYPH[ev.plateId] || '◇'}</span>` +
        `<span class="mark">${suppressed ? 'gewist' : ev.actorId.replace('echo', 'E')}</span>`;
      div.addEventListener('click', (e) => openEventMenu(ev, div, e));
      el.timeline.appendChild(div);
    }
  }

  function openEventMenu(ev, node, e) {
    G.selectedEvent = ev.id;
    renderTimeline();
    const rect = node.getBoundingClientRect();
    // keep the popup fully on-screen (edge chips would otherwise clip it)
    const cx = Math.max(78, Math.min(window.innerWidth - 78, rect.left + rect.width / 2));
    const ty = Math.max(160, rect.top - 8);
    el.menu.style.left = cx + 'px';
    el.menu.style.top = ty + 'px';
    el.menu.classList.remove('hidden');
    const suppressed = G.suppressed.has(key(ev.actorId, ev.plateId));
    el.menu.querySelector('[data-act="erase"]').textContent = suppressed ? 'Herstel' : 'Wissen';
    el.menu.dataset.ev = ev.id;
  }

  el.menu.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const ev = G.events.find(v => v.id === el.menu.dataset.ev);
    el.menu.classList.add('hidden');
    G.selectedEvent = null;
    if (!ev) { renderTimeline(); return; }
    if (act === 'erase') toggleErase(ev);
    else if (act === 'view') { G.viewPulse = { plate: ev.plateId, t: 1 }; renderTimeline(); }
    else renderTimeline();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.menu.contains(e.target) && !e.target.closest('.ev')) el.menu.classList.add('hidden');
  });

  function showOverlay(title, text, btn, cb) {
    el.ovTitle.textContent = title;
    el.ovText.textContent = text;
    el.ovBtn.textContent = btn;
    el.overlay.classList.remove('hidden');
    el.ovBtn.onclick = () => { Sound.init(); el.overlay.classList.add('hidden'); cb(); };
  }

  let titleTimer = 0;
  function flashTitle(msg) { el.levelName.textContent = msg; titleTimer = 1.6; }

  /* ---------------------------------------------------------------------
     INPUT — joystick, buttons, keyboard
  --------------------------------------------------------------------- */
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); weaveNow(); }
    if (e.key.toLowerCase() === 'r') restart();
  });
  window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

  function keyboardDir() {
    if (keys['arrowup'] || keys['w']) return 1;
    if (keys['arrowdown'] || keys['s']) return 2;
    if (keys['arrowleft'] || keys['a']) return 3;
    if (keys['arrowright'] || keys['d']) return 4;
    return 0;
  }

  // Joystick
  const joyBase = document.getElementById('joy-base');
  const joyKnob = document.getElementById('joy-knob');
  let joyId = null, joyDir = 0;
  function joyStart(e) { joyId = e.pointerId; joyBase.setPointerCapture(e.pointerId); joyMove(e); }
  function joyMove(e) {
    if (joyId !== e.pointerId) return;
    const r = joyBase.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const max = r.width / 2;
    const kx = Math.max(-max, Math.min(max, dx));
    const ky = Math.max(-max, Math.min(max, dy));
    joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    if (dist < max * 0.35) joyDir = 0;
    else joyDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 4 : 3) : (dy > 0 ? 2 : 1);
  }
  function joyEnd(e) { if (joyId !== e.pointerId) return; joyId = null; joyDir = 0; joyKnob.style.transform = 'translate(0,0)'; }
  joyBase.addEventListener('pointerdown', joyStart);
  joyBase.addEventListener('pointermove', joyMove);
  joyBase.addEventListener('pointerup', joyEnd);
  joyBase.addEventListener('pointercancel', joyEnd);

  document.getElementById('btn-weave').addEventListener('click', () => { Sound.init(); weaveNow(); });
  document.getElementById('btn-restart').addEventListener('click', restart);

  function restart() { if (G.level) { resetCycle(true); computeEvents(); renderTimeline(); renderHUD(); G.running = true; G.won = false; } }

  function sampleInput() {
    const kd = keyboardDir();
    G.input = kd || joyDir;
  }

  /* ---------------------------------------------------------------------
     MAIN LOOP
  --------------------------------------------------------------------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (G.running && !G.won) {
      sampleInput();
      G.acc += dt;
      while (G.acc >= TICK_DT) {
        G.acc -= TICK_DT;
        doTick();
        Sound.tick();
        if (!G.running) break;
      }
    }
    if (G.breathe > 0) G.breathe = Math.max(0, G.breathe - dt * 1.4);
    if (titleTimer > 0) { titleTimer -= dt; if (titleTimer <= 0 && G.level) el.levelName.textContent = G.level.name; }

    renderRing();
    render();
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------------
     BOOT
  --------------------------------------------------------------------- */
  loadLevel(0);
  renderTimeline();
  requestAnimationFrame(frame);

  /* ---------------------------------------------------------------------
     TEST HOOK — lets an automated test drive the real engine tick by tick.
     Harmless in normal play (nothing calls it).
  --------------------------------------------------------------------- */
  window.__ew = {
    loadLevel,
    setInput: (d) => { G.input = d; },
    tick: () => doTick(),
    weave: weaveNow,
    livePos: () => { const p = posOf('live'); return { x: p.x, y: p.y }; },
    events: () => G.events.map(e => ({ actorId: e.actorId, plateId: e.plateId, tick: e.tick })),
    erase: (actorId, plateId) => toggleErase({ actorId, plateId, anchored: false, id: actorId + ':' + plateId }),
    doorOpen: (id) => G.world.doorOpen[id],
    laserOn: (id) => G.world.laserOn[id],
    echoCount: () => G.echoes.length,
    isWon: () => G.won,
    level: () => G.levelIndex,
  };
})();
