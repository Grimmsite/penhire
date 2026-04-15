const fs = require('fs');
let c = fs.readFileSync('frontend/jobs.html', 'utf8');

const counterFn = `
// ── ANIMATED COUNTER ──
function animateCounter(el, target) {
  const duration = 1000;
  const start = performance.now();
  const startVal = 0;
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(startVal + (target - startVal) * ease).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}
`;

// Add function before renderJobs
c = c.replace(
  '// ── SCHEMA MARKUP FOR SEO ──',
  counterFn + '// ── SCHEMA MARKUP FOR SEO ──'
);

// Use animated counter in renderJobs instead of direct assignment
c = c.replace(
  "document.getElementById('totalCount').textContent = total.toLocaleString();",
  "animateCounter(document.getElementById('totalCount'), total);"
);

fs.writeFileSync('frontend/jobs.html', c, 'utf8');
console.log('Has animateCounter:', c.includes('animateCounter'));