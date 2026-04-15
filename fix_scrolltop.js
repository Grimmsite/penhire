const fs = require('fs');
let c = fs.readFileSync('frontend/jobs.html', 'utf8');

// Add scroll to top button HTML before closing body
const scrollBtn = `
<!-- SCROLL TO TOP -->
<button id="scrollTopBtn" onclick="window.scrollTo({top:0,behavior:'smooth'})" style="display:none;position:fixed;bottom:80px;right:20px;width:44px;height:44px;border-radius:50%;background:var(--gold);color:var(--ink);border:none;cursor:pointer;font-size:1.2rem;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:999;transition:all 0.3s;">↑</button>
`;

// Add scroll listener script
const scrollScript = `
// ── SCROLL TO TOP ──
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scrollTopBtn');
  if (btn) btn.style.display = window.scrollY > 400 ? 'block' : 'none';
});
`;

c = c.replace('</body>', scrollBtn + '\n<script>\n' + scrollScript + '\n</script>\n</body>');

fs.writeFileSync('frontend/jobs.html', c, 'utf8');
console.log('Fixed:', c.includes('scrollTopBtn'));