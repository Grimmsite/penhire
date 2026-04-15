const fs = require('fs');
let c = fs.readFileSync('frontend/jobs.html', 'utf8');

// Add skeleton CSS after spinner CSS
const skeletonCSS = `
  .skeleton-card { background: var(--white); border: 1.5px solid rgba(15,14,12,0.06); border-radius: 16px; padding: 24px; margin-bottom: 12px; display: flex; gap: 16px; }
  .skeleton-logo { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(90deg, var(--cream) 25%, #ede9e0 50%, var(--cream) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; flex-shrink: 0; }
  .skeleton-info { flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .skeleton-line { height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--cream) 25%, #ede9e0 50%, var(--cream) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
  .skeleton-line.short { width: 40%; }
  .skeleton-line.medium { width: 65%; }
  .skeleton-line.long { width: 90%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

c = c.replace(
  '  .spinner {',
  skeletonCSS + '  .spinner {'
);

// Replace loading HTML with skeleton
c = c.replace(
  "list.innerHTML = '<div class=\"loading-state\"><div class=\"spinner\"></div><p>Loading jobs...</p></div>';",
  `list.innerHTML = Array(5).fill(0).map(() => \`
    <div class="skeleton-card">
      <div class="skeleton-logo"></div>
      <div class="skeleton-info">
        <div class="skeleton-line medium"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line long"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>\`).join('');`
);

fs.writeFileSync('frontend/jobs.html', c, 'utf8');
console.log('Has skeleton:', c.includes('skeleton-card'));
console.log('Has shimmer:', c.includes('shimmer'));