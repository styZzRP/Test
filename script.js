/* ============================================================
   LANCEE INSTALLATIETECHNIEK — interactie & elektrische effecten
   ============================================================ */

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Elektrisch achtergrond-canvas ---------- */
(() => {
  const canvas = document.getElementById("electric-canvas");
  if (!canvas || reducedMotion) return;

  const ctx = canvas.getContext("2d");
  let w, h, particles;
  let bolts = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.min(90, Math.floor((w * h) / 22000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.4,
      hue: Math.random() < 0.8 ? 190 : 48, // meestal cyaan, soms geel
    }));
  }

  // Vertakte bliksemschicht opbouwen als lijstje segmenten
  function makeBolt() {
    const startX = Math.random() * w;
    const segs = [];
    let x = startX;
    let y = -20;
    const targetY = h * (0.4 + Math.random() * 0.5);
    while (y < targetY) {
      const nx = x + (Math.random() - 0.5) * 90;
      const ny = y + 24 + Math.random() * 46;
      segs.push({ x1: x, y1: y, x2: nx, y2: ny });
      // af en toe een zijtak
      if (Math.random() < 0.3) {
        const bx = nx + (Math.random() - 0.5) * 140;
        const by = ny + 30 + Math.random() * 60;
        segs.push({ x1: nx, y1: ny, x2: bx, y2: by, branch: true });
      }
      x = nx;
      y = ny;
    }
    bolts.push({ segs, life: 1 });
  }

  function drawBolts() {
    bolts = bolts.filter((b) => b.life > 0);
    for (const b of bolts) {
      ctx.save();
      ctx.globalAlpha = b.life;
      ctx.strokeStyle = "#e8f9ff";
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = 18;
      for (const s of b.segs) {
        ctx.lineWidth = s.branch ? 1 : 2.2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
      ctx.restore();
      b.life -= 0.045;
    }
  }

  function tick() {
    ctx.clearRect(0, 0, w, h);

    // deeltjes + verbindingslijntjes
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.hue === 48 ? "rgba(250,204,21,0.7)" : "rgba(34,211,238,0.55)";
      ctx.fill();
    }

    ctx.lineWidth = 0.6;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 130 * 130) {
          ctx.strokeStyle = `rgba(34,211,238,${0.14 * (1 - d2 / (130 * 130))})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    drawBolts();
    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  tick();

  // af en toe onweer
  setInterval(() => {
    if (Math.random() < 0.55) makeBolt();
  }, 3800);
})();

/* ---------- Cursor-gloed ---------- */
(() => {
  const glow = document.querySelector(".cursor-glow");
  if (!glow) return;
  window.addEventListener("pointermove", (e) => {
    glow.style.left = e.clientX + "px";
    glow.style.top = e.clientY + "px";
  });
})();

/* ---------- Nav: scroll-status + mobiel menu ---------- */
(() => {
  const nav = document.getElementById("nav");
  const burger = document.getElementById("navBurger");
  const links = document.getElementById("navLinks");

  const onScroll = () => nav.classList.toggle("nav--scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  burger.addEventListener("click", () => {
    burger.classList.toggle("open");
    links.classList.toggle("open");
  });

  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      burger.classList.remove("open");
      links.classList.remove("open");
    })
  );
})();

/* ---------- Scroll-reveal ---------- */
(() => {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || reducedMotion) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => io.observe(el));
})();

/* ---------- Tellende statistieken ---------- */
(() => {
  const nums = document.querySelectorAll(".stat__num");
  if (!nums.length) return;

  const animate = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const dur = 1800;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString("nl-NL");
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (reducedMotion || !("IntersectionObserver" in window)) {
    nums.forEach((el) => (el.textContent = parseInt(el.dataset.count, 10).toLocaleString("nl-NL")));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.6 }
  );
  nums.forEach((el) => io.observe(el));
})();

/* ---------- Contactformulier (demo) ---------- */
(() => {
  const form = document.getElementById("contactForm");
  const success = document.getElementById("formSuccess");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // Geen backend gekoppeld: toon bevestiging en maak het formulier leeg.
    success.hidden = false;
    form.reset();
    success.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
})();

/* ---------- Jaartal in footer ---------- */
document.getElementById("year").textContent = new Date().getFullYear();
