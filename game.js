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

    /* ---- World 3: Het Archief van Vergeten Dingen ---- */
    {
      name: 'Het oude ware',
      hint: 'Een TIJDANKER (◆) onthoudt of de deur ooit open was — voor altijd. ' +
            'Laat je echo de deur openen zodat het anker het onthoudt, en WIS daarna ' +
            'die gebeurtenis: de laser dooft, maar de brug blijft bestaan omdat het ' +
            'anker de oude waarheid bewaart. De deur is tegelijk open én dicht.',
      rows: [
        '#############',
        '#P.........@#',
        '#...........#',
        '#..A.a......#',
        '#~~~~~~~~~~~#',
        '#.....b.....#',
        '#.....G.....#',
        '#############',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: {
        a: { controllers: [{ plate: 'A' }] },
        b: { controllers: [{ anchor: 'T' }] },   // bridge: open once the anchor remembers
      },
      lasers: { L: { controllers: [{ door: 'a' }] } }, // laser on while door a is open
      anchors: { T: { watch: { door: 'a' } } },
    },
    {
      name: 'De groeiende brug',
      hint: 'Een TIJDZAAD (❁) groeit met het aantal gebeurtenissen. Laat meerdere ' +
            'echo\'s de plaat aanraken tot de plant genoeg gebeurtenissen telt en de ' +
            'brug vormt. Wissen laat de plant juist krimpen.',
      rows: [
        '###########',
        '#P...A....#',
        '#.........#',
        '#....&....#',
        '#####b#####',
        '#....G....#',
        '###########',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { b: { controllers: [{ seed: 'S' }] } },   // bridge opens at seed stage >= target
      lasers: {},
      seeds: { S: { thresholds: [1, 2, 3], target: 3 } }, // needs 3 events to bridge
    },

    /* ---- Fragile memories ---- */
    {
      name: 'Vervagende echo\'s',
      hint: 'Deze herinneringen VERVAGEN na 3 cycli — zie het cijfer op de chip. ' +
            'Laat je echo de plaat bezet houden en bereik het kristal vóór je echo ' +
            'oplost in licht.',
      rows: [
        '###########',
        '#P........#',
        '#.........#',
        '#...A.....#',
        '#####a#####',
        '#....G....#',
        '#.........#',
        '###########',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: {},
      fadeCycles: 3,
    },

    /* ---- Shadow echoes ---- */
    {
      name: 'Je spiegelbeeld',
      hint: 'Je echo is je SCHADUW: het puntspiegelbeeld van jou — het loopt waar jij ' +
            'níet liep. Ga naar de tegenoverliggende hoek zodat je schaduw de plaat ' +
            'bezet houdt, en loop dan naar het kristal.',
      rows: [
        '###########',
        '#P........#',
        '#.........#',
        '#####a#####',
        '#.........#',
        '#.........#',
        '#.......A.#',
        '#....G....#',
        '###########',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: {},
      echoType: 'shadow',
    },

    /* ---- Move-event ---- */
    {
      name: 'Op het juiste moment',
      hint: 'Nieuw: VERSCHUIF een gebeurtenis in de tijd (tik op een chip → Verschuif). ' +
            'Je echo houdt de deur open; verschuif zijn timing als het net niet uitkomt.',
      rows: [
        '###########',
        '#P........#',
        '#.........#',
        '#...A.....#',
        '#####a#####',
        '#....G....#',
        '#.........#',
        '###########',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: {},
      allowMove: true,
    },

    /* ---- World 2: De Spiegelkloof (light + mirrors) ---- */
    {
      name: 'De Spiegelkloof',
      hint: 'Licht straalt uit de bron. Stap op de SPIEGEL (/) om hem te draaien zodat ' +
            'de straal de sensor (◎) raakt en de deur naar het kristal opent. Wis de ' +
            'draai-gebeurtenis en het licht keert terug naar de oude stand.',
      rows: [
        '#############',
        '#.........G.#',
        '#######a#####',
        '#...........#',
        '#*....A.....#',
        '#P....o.....#',
        '#...........#',
        '#############',
      ],
      plates: { A: { kind: 'mirror', base: '/' } },
      doors: { a: { controllers: [{ sensor: 'X' }] } },
      lasers: {},
      emitters: { E: { dir: 'right' } },
      sensors: { X: {} },
    },

    /* ---- The Forgetter ---- */
    {
      name: 'De Vergeter',
      hint: 'De plaat is VERANKERD — je kunt zijn gebeurtenis niet wissen, en hij ' +
            'schakelt de laser in. Maar DE VERGETER eet gebeurtenissen op. Lok hem ' +
            '(hij kruipt naar jou toe) over de plaat, zodat de laser nooit aanging.',
      rows: [
        '###########',
        '#P.B....F.#',
        '#~~~~~~~~~#',
        '#.........#',
        '#....G....#',
        '###########',
      ],
      plates: { B: { kind: 'latch', anchored: true } },
      doors: {},
      lasers: { L: { controllers: [{ plate: 'B' }] } },
    },

    /* ---- World 5: shared timeline across two rooms ---- */
    {
      name: 'Twee Kamers',
      hint: 'Twee kamers delen één geschiedenis. De knop LINKS opent een deur RECHTS. ' +
            'Laat je echo de knop links ingedrukt houden, stap door het portaal (◉) ' +
            'naar rechts, en loop door de deur naar het kristal.',
      rows: [
        '#############',
        '#P..A.#..G..#',
        '#.....#.....#',
        '#.....#.a...#',
        '#.....#.....#',
        '#..p..#.q...#',
        '#############',
      ],
      plates: { A: { kind: 'pressure' } },
      doors: { a: { controllers: [{ plate: 'A' }] } },
      lasers: {},
    },
  ];

  /* ---------------------------------------------------------------------
     LEVEL PARSING
  --------------------------------------------------------------------- */
  function parseLevel(def) {
    const H = def.rows.length, W = def.rows[0].length;
    const walls = [];
    let spawn = null, goal = null, forgetter = null;
    const plateCells = {}, doorCells = {}, laserCells = [];
    const anchorCells = [], seedCells = [], emitterCells = [], sensorCells = [], portalCells = [];

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
        else if (ch === '*') emitterCells.push({ x, y });
        else if (ch === 'o') sensorCells.push({ x, y });
        else if (ch === 'F') forgetter = { x, y };
        else if (ch === 'p' || ch === 'q') portalCells.push({ x, y });
        else if (ch === '@') anchorCells.push({ x, y });
        else if (ch === '&') seedCells.push({ x, y });
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
    // anchors ('@') and seeds ('&') — assigned to their def ids in map order
    const anchors = {};
    Object.keys(def.anchors || {}).forEach((id, i) => {
      anchors[id] = { id, ...def.anchors[id], ...anchorCells[i], remembered: false };
    });
    const seeds = {};
    Object.keys(def.seeds || {}).forEach((id, i) => {
      seeds[id] = { id, ...def.seeds[id], ...seedCells[i] };
    });
    const emitters = {};
    Object.keys(def.emitters || {}).forEach((id, i) => {
      emitters[id] = { id, ...def.emitters[id], ...emitterCells[i] };
    });
    const sensors = {};
    Object.keys(def.sensors || {}).forEach((id, i) => {
      sensors[id] = { id, ...def.sensors[id], ...sensorCells[i] };
    });

    return {
      name: def.name, hint: def.hint, W, H, walls, spawn, goal, plates, doors, lasers, anchors, seeds,
      emitters, sensors, forgetter, portals: portalCells.length === 2 ? portalCells : null,
      echoType: def.echoType || 'normal',   // 'normal' | 'shadow'
      fadeCycles: def.fadeCycles || 0,       // >0 => fragile memories
      allowMove: !!def.allowMove,            // enable "Verschuif" in the timeline menu
    };
  }

  /* ---------------------------------------------------------------------
     GAME STATE
  --------------------------------------------------------------------- */
  const DIRS = [ {x:0,y:0}, {x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0} ]; // 0 wait,U,D,L,R
  const INV = [0, 2, 1, 4, 3];   // invert a direction (point reflection): U<->D, L<->R
  const MOVE_STEP = 8;           // "shift event" granularity: 8 ticks = 1s
  const MOVE_MAX = 32;           // up to 3s of delay, then wraps to 0

  // An echo's direction at tick t, honouring its time offset (move-event).
  function echoDir(e, t) {
    const i = t - (e.offset || 0);
    if (i < 0 || i >= CYCLE_TICKS) return 0;
    return e.track[i] || 0;
  }

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
    cycleCount: 0,       // cycles woven so far (for fragile memories)
    forgotten: new Set(),// events permanently eaten by the Forgetter
    fpos: null,          // Forgetter position (resets each cycle)
    ftimer: 0,
  };

  const FORGET_SPEED = 3;   // ticks between the Forgetter's slow steps

  /* ---------------------------------------------------------------------
     SIMULATION CORE
     A "world" tracks door/laser/latch state. objectsFromPositions() derives
     it from where the actors currently stand (respecting suppression).
  --------------------------------------------------------------------- */
  function freshWorld() {
    const w = { doorOpen: {}, laserOn: {}, latched: {}, occ: {}, sensorLit: {}, beam: [] };
    for (const id in G.level.doors) w.doorOpen[id] = false;
    for (const id in G.level.lasers) w.laserOn[id] = false;
    for (const id in G.level.plates) { w.latched[id] = false; w.occ[id] = new Set(); }
    for (const id in G.level.sensors) w.sensorLit[id] = false;
    return w;
  }

  const key = (actorId, plateId) => actorId + '|' + plateId;
  // An echo's contribution is gone if you erased it or the Forgetter ate it.
  const isBlocked = (actorId, plateId) =>
    G.suppressed.has(key(actorId, plateId)) || G.forgotten.has(key(actorId, plateId));

  // Which actors (by id) currently occupy each plate, ignoring blocked echoes.
  function computeOccupancy(positions) {
    const occ = {};
    for (const id in G.level.plates) occ[id] = new Set();
    for (const p of positions) {
      for (const id in G.level.plates) {
        const pl = G.level.plates[id];
        if (p.x === pl.x && p.y === pl.y) {
          if (p.actorId !== 'live' && isBlocked(p.actorId, id)) continue;
          occ[id].add(p.actorId);
        }
      }
    }
    return occ;
  }

  // Update latches on rising edges, then derive doors & lasers.
  function deriveWorld(world, occ, positions) {
    for (const id in G.level.plates) {
      const pl = G.level.plates[id];
      const now = occ[id].size > 0;
      const before = world.occ[id].size > 0;
      // latches and mirrors both flip on a rising edge (stepping on)
      if ((pl.kind === 'latch' || pl.kind === 'mirror') && now && !before) world.latched[id] = !world.latched[id];
      world.occ[id] = occ[id];
    }
    // Light: raycast every emitter, reflecting off mirrors, lighting sensors.
    computeBeams(world, positions);
    // A controller may reference a plate, an anchor (persistent memory),
    // a seed (grows with events), a light sensor or another door.
    const active = (c) => {
      if (c.plate) {
        const pl = G.level.plates[c.plate];
        return (pl.kind === 'latch' || pl.kind === 'mirror') ? world.latched[c.plate] : world.occ[c.plate].size > 0;
      }
      if (c.anchor) return !!(G.level.anchors[c.anchor] && G.level.anchors[c.anchor].remembered);
      if (c.seed) return seedStage(c.seed) >= (G.level.seeds[c.seed].target || 1);
      if (c.sensor) return !!world.sensorLit[c.sensor];
      if (c.door) return !!world.doorOpen[c.door];
      return false;
    };
    for (const id in G.level.doors) {
      const d = G.level.doors[id];
      let open = false;
      for (const c of (d.controllers || [])) {
        if (c.close) continue;
        if (active(c) !== !!c.invert) open = true;
      }
      for (const c of (d.controllers || [])) {
        if (c.close && active(c)) open = false;
      }
      world.doorOpen[id] = open;
    }
    for (const id in G.level.lasers) {
      const l = G.level.lasers[id];
      let on = false;
      for (const c of (l.controllers || [])) if (active(c) !== !!c.invert) on = true;
      world.laserOn[id] = on;
    }
    return world;
  }

  const DIRVEC = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

  // A mirror plate's current orientation: base, flipped once per rotation.
  function mirrorOrient(id, world) {
    const base = G.level.plates[id].base;
    const flip = world.latched[id];
    return flip ? (base === '/' ? '\\' : '/') : base;
  }
  function reflect(d, orient) {
    return orient === '/' ? { x: -d.y, y: -d.x } : { x: d.y, y: d.x };
  }

  // Cast each emitter's beam through the grid, bouncing off mirrors, stopping
  // at walls and actors, and lighting any sensor it reaches.
  function computeBeams(world, positions) {
    world.beam = [];
    for (const id in G.level.sensors) world.sensorLit[id] = false;
    if (!Object.keys(G.level.emitters).length) return;

    const L = G.level;
    const blocked = new Set((positions || []).map(p => p.x + ',' + p.y));
    const mirrorAt = (x, y) => {
      for (const id in L.plates) { const pl = L.plates[id]; if (pl.kind === 'mirror' && pl.x === x && pl.y === y) return id; }
      return null;
    };
    const sensorAt = (x, y) => {
      for (const id in L.sensors) { const s = L.sensors[id]; if (s.x === x && s.y === y) return id; }
      return null;
    };

    for (const eid in L.emitters) {
      const em = L.emitters[eid];
      let x = em.x, y = em.y, d = DIRVEC[em.dir] || DIRVEC.right;
      for (let step = 0; step < 500; step++) {
        x += d.x; y += d.y;
        if (x < 0 || y < 0 || x >= L.W || y >= L.H || L.walls[y][x]) break;
        if (blocked.has(x + ',' + y)) { world.beam.push({ x, y, hit: true }); break; }
        const mid = mirrorAt(x, y);
        if (mid) { d = reflect(d, mirrorOrient(mid, world)); world.beam.push({ x, y, mirror: true }); continue; }
        const sid = sensorAt(x, y);
        if (sid) { world.sensorLit[sid] = true; world.beam.push({ x, y, sensor: true }); break; }
        world.beam.push({ x, y });
      }
    }
  }

  // Non-erased events currently on the timeline — drives seed growth.
  function activeEventCount() {
    let n = 0;
    for (const e of G.events) if (!G.suppressed.has(key(e.actorId, e.plateId))) n++;
    return n;
  }
  // A seed's stage = how many of its thresholds the active-event count clears.
  function seedStage(id) {
    const s = G.level.seeds[id];
    if (!s) return 0;
    const th = s.thresholds || [1];
    let stage = 0;
    for (const t of th) if (activeEventCount() >= t) stage++;
    return stage;
  }

  // Is a time anchor's watched condition true right now (in the live world)?
  function anchorWitnesses(a) {
    const w = a.watch || {};
    if (w.door) return !!G.world.doorOpen[w.door];
    if (w.laserOff) return !G.world.laserOn[w.laserOff];
    if (w.plate) {
      const pl = G.level.plates[w.plate];
      return pl && (pl.kind === 'latch' ? G.world.latched[w.plate] : G.world.occ[w.plate].size > 0);
    }
    return false;
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
    // portals: stepping onto one warps you to its partner (linking two rooms)
    const pr = G.level.portals;
    if (pr) {
      const [pa, pb] = pr;
      for (const p of positions) {
        const onA = p.x === pa.x && p.y === pa.y, wasA = p.prevX === pa.x && p.prevY === pa.y;
        const onB = p.x === pb.x && p.y === pb.y, wasB = p.prevX === pb.x && p.prevY === pb.y;
        if (onA && !wasA) { p.x = pb.x; p.y = pb.y; p.prevX = pb.x; p.prevY = pb.y; }
        else if (onB && !wasB) { p.x = pa.x; p.y = pa.y; p.prevX = pa.x; p.prevY = pa.y; }
      }
    }
    // re-derive world from the new positions
    deriveWorld(world, computeOccupancy(positions), positions);
  }

  /* ---------------------------------------------------------------------
     EVENT TIMELINE — computed by simulating echoes only (deterministic)
  --------------------------------------------------------------------- */
  function computeEvents() {
    const events = [];
    if (!G.echoes.length) { G.events = events; return; }
    const world = freshWorld();
    const positions = G.echoes.map(e => ({ actorId: e.id, x: e.spawn.x, y: e.spawn.y }));
    deriveWorld(world, computeOccupancy(positions), positions);
    const onPlate = {}; // actorId+plate -> currently on

    for (let t = 0; t < CYCLE_TICKS; t++) {
      const dirs = {};
      for (const e of G.echoes) dirs[e.id] = echoDir(e, t);
      stepTick(positions, dirs, world);
      for (const p of positions) {
        for (const id in G.level.plates) {
          const pl = G.level.plates[id];
          const on = (p.x === pl.x && p.y === pl.y);
          const k = p.actorId + id;
          // events the Forgetter ate vanish from the timeline entirely
          if (on && !onPlate[k] && !G.forgotten.has(key(p.actorId, id))) {
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
      G.cycleCount = 0;
      G.forgotten = new Set();   // what the Forgetter ate only clears on full reset
      // a full reset wipes time-anchor memory; erasing (partial) keeps it.
      for (const id in G.level.anchors) G.level.anchors[id].remembered = false;
    }
    G.tick = 0; G.acc = 0;
    G.live = { id: 'live', track: [], spawn: G.level.spawn };
    G.world = freshWorld();
    // the Forgetter re-walks from its start every cycle
    if (G.level.forgetter) { G.fpos = { x: G.level.forgetter.x, y: G.level.forgetter.y, px: G.level.forgetter.x, py: G.level.forgetter.y }; G.ftimer = 0; }
    else G.fpos = null;
    // place all actors at spawn
    positionsInit();
    deriveWorld(G.world, computeOccupancy(currentPositions()), currentPositions());
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
    for (const e of G.echoes) dirs[e.id] = echoDir(e, G.tick);
    dirs['live'] = G.input;
    G.live.track[G.tick] = G.input;

    stepTick(POS, dirs, G.world);

    // Time anchors witness the live timeline and remember forever — even
    // after the causing event is later erased. This is the paradox engine.
    for (const id in G.level.anchors) {
      const a = G.level.anchors[id];
      if (!a.remembered && anchorWitnesses(a)) { a.remembered = true; G.breathe = Math.max(G.breathe, 0.6); }
    }

    // The Forgetter creeps toward you; lure it onto a plate to eat its events.
    if (G.fpos && moveForgetter()) return;   // ate something -> room rewound

    G.tick++;

    // win: the live player reached the crystal
    const lp = posOf('live');
    if (lp && lp.x === G.level.goal.x && lp.y === G.level.goal.y) { winLevel(); return; }

    if (G.tick >= CYCLE_TICKS) endCycle();
  }

  // Returns true if it ate an event (which rewinds the cycle).
  function moveForgetter() {
    const f = G.fpos, target = posOf('live');
    f.px = f.x; f.py = f.y;
    if (++G.ftimer >= FORGET_SPEED) {
      G.ftimer = 0;
      const dx = Math.sign(target.x - f.x), dy = Math.sign(target.y - f.y);
      const free = (x, y) => x >= 0 && y >= 0 && x < G.level.W && y < G.level.H && !G.level.walls[y][x];
      if (Math.abs(target.x - f.x) >= Math.abs(target.y - f.y)) {
        if (dx && free(f.x + dx, f.y)) f.x += dx;
        else if (dy && free(f.x, f.y + dy)) f.y += dy;
      } else {
        if (dy && free(f.x, f.y + dy)) f.y += dy;
        else if (dx && free(f.x + dx, f.y)) f.x += dx;
      }
    }
    // eat any event whose plate the Forgetter now stands on
    for (const id in G.level.plates) {
      const pl = G.level.plates[id];
      if (pl.x !== f.x || pl.y !== f.y) continue;
      const victims = G.events.filter(e => e.plateId === id && !G.forgotten.has(key(e.actorId, e.plateId)));
      if (victims.length) {
        for (const v of victims) G.forgotten.add(key(v.actorId, v.plateId));
        G.breathe = 1; Sound.erase();
        resetCycle(false);       // history rewrites: the eaten event never was
        computeEvents(); renderTimeline(); renderHUD();
        return true;
      }
    }
    return false;
  }

  function endCycle() {
    // finalise the live recording into an echo (pad track to full length)
    for (let t = 0; t < CYCLE_TICKS; t++) if (G.live.track[t] == null) G.live.track[t] = 0;
    G.cycleCount++;

    if (G.echoes.length < MAX_ECHOES) {
      const shadow = G.level.echoType === 'shadow';
      let spawn = G.level.spawn, track = G.live.track.slice();
      if (shadow) {
        // Shadow-Echo: the point-reflection of you — walks where you did NOT.
        spawn = { x: G.level.W - 1 - spawn.x, y: G.level.H - 1 - spawn.y };
        track = track.map(d => INV[d]);
      }
      G.echoes.push({
        id: 'echo' + (G.cycleCount), track, spawn,
        offset: 0, bornCycle: G.cycleCount, shadow,
      });
    } else {
      flashTitle('Max echoes bereikt — herstart (↺)');
    }

    // Fragile memories: echoes older than fadeCycles dissolve into light.
    if (G.level.fadeCycles) {
      G.echoes = G.echoes.filter(e => (G.cycleCount - e.bornCycle) < G.level.fadeCycles);
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

    // portals (linking the two rooms)
    if (L.portals) for (const p of L.portals) drawPortal(ox + (p.x + 0.5) * cell, oy + (p.y + 0.5) * cell, cell);
    // light beam (under the objects it touches)
    for (const b of (G.world.beam || [])) drawBeam(ox + (b.x + 0.5) * cell, oy + (b.y + 0.5) * cell, cell);
    // emitters + sensors
    for (const id in L.emitters) { const e = L.emitters[id]; drawEmitter(ox + (e.x + 0.5) * cell, oy + (e.y + 0.5) * cell, cell, e.dir); }
    for (const id in L.sensors) { const s = L.sensors[id]; drawSensor(ox + (s.x + 0.5) * cell, oy + (s.y + 0.5) * cell, cell, G.world.sensorLit[id]); }

    // plates & mirrors
    for (const id in L.plates) {
      const pl = L.plates[id];
      if (pl.kind === 'mirror') {
        drawMirror(ox + (pl.x + 0.5) * cell, oy + (pl.y + 0.5) * cell, cell, mirrorOrient(id, G.world));
      } else {
        const active = pl.kind === 'latch' ? G.world.latched[id] : G.world.occ[id].size > 0;
        drawPlate(ox + pl.x * cell, oy + pl.y * cell, cell, pl.color, active, pl.kind === 'latch');
      }
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

    // time anchors
    for (const id in L.anchors) {
      const a = L.anchors[id];
      drawAnchor(ox + (a.x + 0.5) * cell, oy + (a.y + 0.5) * cell, cell, a.remembered);
    }
    // time seeds (plants)
    for (const id in L.seeds) {
      const s = L.seeds[id];
      drawSeed(ox + (s.x + 0.5) * cell, oy + (s.y + 1) * cell, cell, seedStage(id), (s.thresholds || [1]).length);
    }

    // goal crystal
    drawCrystal(ox + (L.goal.x + 0.5) * cell, oy + (L.goal.y + 0.5) * cell, cell);

    // echoes then player
    for (const p of POS) {
      if (p.actorId === 'live') continue;
      const rx = ox + (lerp(p.prevX, p.x, alpha) + 0.5) * cell;
      const ry = oy + (lerp(p.prevY, p.y, alpha) + 0.5) * cell;
      const echo = G.echoes.find(e => e.id === p.actorId);
      drawActor(rx, ry, cell, echo && echo.shadow ? 'shadow' : 'echo');
    }
    const lp = posOf('live');
    if (lp) {
      const rx = ox + (lerp(lp.prevX, lp.x, alpha) + 0.5) * cell;
      const ry = oy + (lerp(lp.prevY, lp.y, alpha) + 0.5) * cell;
      drawActor(rx, ry, cell, 'live');
    }

    // the Forgetter
    if (G.fpos) {
      const fa = Math.min(1, G.ftimer / FORGET_SPEED);
      const fx = ox + (lerp(G.fpos.px, G.fpos.x, fa) + 0.5) * cell;
      const fy = oy + (lerp(G.fpos.py, G.fpos.y, fa) + 0.5) * cell;
      drawForgetter(fx, fy, cell);
    }

    ctx.restore();
  }

  function drawForgetter(cx, cy, cell) {
    const r = cell * 0.34;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(cx, cy);
    // a dark void that swallows light, ringed with a jittering violet edge
    ctx.fillStyle = 'rgba(6,7,16,0.92)';
    ctx.shadowBlur = 22; ctx.shadowColor = '#5a2a7a';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(180,120,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = r * (0.9 + 0.12 * Math.sin(a * 3 + t * 4));
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  function drawActor(x, y, cell, kind) {
    const r = cell * 0.3;
    ctx.save();
    if (kind === 'shadow') {
      // negative self: a hollow violet outline
      ctx.shadowBlur = 16; ctx.shadowColor = '#c08bff';
      ctx.strokeStyle = '#c08bff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
      roundRect(x - r, y - r, r * 2, r * 2, r * 0.5); ctx.stroke();
    } else {
      const isEcho = kind === 'echo';
      ctx.shadowBlur = 18; ctx.shadowColor = isEcho ? '#7ff0ff' : '#eaf0ff';
      ctx.globalAlpha = isEcho ? 0.55 : 1;
      ctx.fillStyle = isEcho ? 'rgba(127,240,255,0.5)' : '#eaf0ff';
      roundRect(x - r, y - r, r * 2, r * 2, r * 0.5); ctx.fill();
    }
    ctx.restore();
  }

  function drawBeam(cx, cy, cell) {
    const r = cell * 0.42;
    ctx.save();
    ctx.fillStyle = 'rgba(255,212,121,0.16)';
    ctx.shadowBlur = 12; ctx.shadowColor = '#ffd479';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  function drawEmitter(cx, cy, cell, dir) {
    const r = cell * 0.24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffd479'; ctx.shadowBlur = 16; ctx.shadowColor = '#ffd479';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // little nib pointing the beam direction
    const v = DIRVEC[dir] || DIRVEC.right;
    ctx.fillRect(v.x * r, v.y * r, Math.max(3, Math.abs(v.x) * cell * 0.18) || 3, Math.max(3, Math.abs(v.y) * cell * 0.18) || 3);
    ctx.restore();
  }

  function drawSensor(cx, cy, cell, lit) {
    const r = cell * 0.24;
    ctx.save();
    ctx.strokeStyle = lit ? '#ffd479' : '#5a6aa8'; ctx.lineWidth = 2;
    ctx.shadowBlur = lit ? 18 : 3; ctx.shadowColor = '#ffd479';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    if (lit) { ctx.fillStyle = 'rgba(255,212,121,0.6)'; ctx.fill(); } else ctx.stroke();
    ctx.restore();
  }

  function drawPortal(cx, cy, cell) {
    const r = cell * 0.3;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t);
    ctx.strokeStyle = '#7ff0ff'; ctx.lineWidth = 2;
    ctx.shadowBlur = 14; ctx.shadowColor = '#7ff0ff';
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.4 + k * 0.2;
      ctx.beginPath(); ctx.arc(0, 0, r * (1 - k * 0.28), 0, Math.PI * 1.5); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMirror(cx, cy, cell, orient) {
    const r = cell * 0.32;
    ctx.save();
    ctx.strokeStyle = '#cfe0ff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.shadowBlur = 10; ctx.shadowColor = '#7ff0ff';
    ctx.beginPath();
    if (orient === '/') { ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); }
    else { ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); }
    ctx.stroke();
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

  function drawAnchor(cx, cy, cell, remembered) {
    const r = cell * 0.26;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = remembered ? '#b98cff' : '#5a6aa8';
    ctx.fillStyle = 'rgba(185,140,255,0.16)';
    ctx.lineWidth = 2;
    ctx.shadowBlur = remembered ? 20 : 4; ctx.shadowColor = '#b98cff';
    // a diamond ring (memory) with an inner mark that lights when remembered
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    if (remembered) ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.45); ctx.lineTo(r * 0.45, 0); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r * 0.45, 0); ctx.closePath();
    ctx.globalAlpha = remembered ? 0.9 : 0.4;
    ctx.stroke();
    ctx.restore();
  }

  function drawSeed(cx, baseY, cell, stage, maxStage) {
    const grow = stage / maxStage;                 // 0..1
    const h = cell * (0.15 + grow * 0.7);
    ctx.save();
    ctx.strokeStyle = '#8affa0'; ctx.lineWidth = 2;
    ctx.shadowBlur = 10 + grow * 12; ctx.shadowColor = '#8affa0';
    ctx.globalAlpha = 0.5 + grow * 0.5;
    // stem
    ctx.beginPath(); ctx.moveTo(cx, baseY - 3); ctx.lineTo(cx, baseY - h); ctx.stroke();
    // leaves per stage
    for (let i = 0; i < stage; i++) {
      const ly = baseY - 4 - (i + 1) * (h - 4) / (maxStage + 0.5);
      const side = i % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(cx, ly);
      ctx.quadraticCurveTo(cx + side * cell * 0.22, ly - cell * 0.06, cx + side * cell * 0.28, ly);
      ctx.quadraticCurveTo(cx + side * cell * 0.22, ly + cell * 0.06, cx, ly);
      ctx.stroke();
    }
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
      const echo = G.echoes.find(e => e.id === ev.actorId);
      const div = document.createElement('div');
      div.className = 'ev' + (suppressed ? ' erased' : '') + (ev.anchored ? ' anchored' : '') +
        (echo && echo.shadow ? ' shadow' : '') + (G.selectedEvent === ev.id ? ' sel' : '');
      div.style.color = echo && echo.shadow ? '#c08bff' : ev.color;

      let mark = suppressed ? 'gewist' : ev.actorId.replace('echo', 'E');
      if (echo && echo.offset) mark += ' +' + (echo.offset / TICK_RATE).toFixed(0) + 's';
      // fragile memory: cycles left before this echo fades
      let badge = '';
      if (G.level.fadeCycles && echo) {
        const left = G.level.fadeCycles - (G.cycleCount - echo.bornCycle);
        badge = `<span class="fade">${left}</span>`;
      }
      div.innerHTML = `<span class="glyph">${PLATE_GLYPH[ev.plateId] || '◇'}${badge}</span>` +
        `<span class="mark">${mark}</span>`;
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
    // "Verschuif" only where the level enables moving events
    const moveBtn = el.menu.querySelector('[data-act="move"]');
    const echo = G.echoes.find(en => en.id === ev.actorId);
    moveBtn.style.display = G.level.allowMove ? '' : 'none';
    moveBtn.textContent = 'Verschuif' + (echo && echo.offset ? ' (+' + (echo.offset / TICK_RATE).toFixed(0) + 's)' : '');
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
    else if (act === 'move') moveEvent(ev);
    else if (act === 'view') { G.viewPulse = { plate: ev.plateId, t: 1 }; renderTimeline(); }
    else renderTimeline();
  });

  // Shift an echo's whole replay later in time (its events happen X seconds
  // later). Rewinds the room so the new timing re-derives everything.
  function moveEvent(ev) {
    const echo = G.echoes.find(en => en.id === ev.actorId);
    if (!echo) return;
    echo.offset = ((echo.offset || 0) + MOVE_STEP) % MOVE_MAX;
    G.breathe = 1;
    Sound.erase();
    resetCycle(false);
    computeEvents();
    renderHUD();
    renderTimeline();
  }
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

  // Floating drag-to-steer: touch anywhere on the board and drag toward
  // where you want to go. The stick appears under the thumb and trails it.
  const board = document.getElementById('board');
  const actions = document.getElementById('actions');
  const joy = document.getElementById('joystick');
  const joyKnob = document.getElementById('joy-knob');
  const LEASH = 48, DEAD = 12;
  let steerId = null, ox = 0, oy = 0, joyDir = 0;

  function placeJoy(clientX, clientY) {
    const r = board.getBoundingClientRect();
    joy.style.left = (clientX - r.left) + 'px';
    joy.style.top = (clientY - r.top) + 'px';
  }
  function steerStart(e) {
    if (actions.contains(e.target)) return;                 // don't steal button taps
    if (!el.overlay.classList.contains('hidden')) return;   // ignore while overlay up
    steerId = e.pointerId;
    ox = e.clientX; oy = e.clientY;
    placeJoy(ox, oy);
    joyKnob.style.transform = 'translate(0,0)';
    joy.classList.add('active');
    joyDir = 0;
    Sound.init();
    e.preventDefault();
  }
  function steerMove(e) {
    if (e.pointerId !== steerId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const dist = Math.hypot(dx, dy);
    if (dist > LEASH) {                                      // trail the origin along
      ox = e.clientX - (dx / dist) * LEASH;
      oy = e.clientY - (dy / dist) * LEASH;
      placeJoy(ox, oy);
      dx = e.clientX - ox; dy = e.clientY - oy;
    }
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyDir = dist < DEAD ? 0 : (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 4 : 3) : (dy > 0 ? 2 : 1));
    e.preventDefault();
  }
  function steerEnd(e) {
    if (e.pointerId !== steerId) return;
    steerId = null; joyDir = 0;
    joy.classList.remove('active');
  }
  board.addEventListener('pointerdown', steerStart);
  board.addEventListener('pointermove', steerMove);
  board.addEventListener('pointerup', steerEnd);
  board.addEventListener('pointercancel', steerEnd);

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
    anchorRemembered: (id) => !!(G.level.anchors[id] && G.level.anchors[id].remembered),
    sensorLit: (id) => !!G.world.sensorLit[id],
    mirrorOrient: (id) => mirrorOrient(id, G.world),
    forgetterPos: () => G.fpos ? { x: G.fpos.x, y: G.fpos.y } : null,
    isForgotten: (actorId, plateId) => G.forgotten.has(actorId + '|' + plateId),
    seedStage: (id) => seedStage(id),
    eventCount: () => activeEventCount(),
    echoCount: () => G.echoes.length,
    echoIds: () => G.echoes.map(e => e.id),
    moveEcho: (id) => { const e = G.echoes.find(x => x.id === id); if (e) { e.offset = ((e.offset || 0) + MOVE_STEP) % MOVE_MAX; resetCycle(false); computeEvents(); } },
    isWon: () => G.won,
    level: () => G.levelIndex,
  };
})();
