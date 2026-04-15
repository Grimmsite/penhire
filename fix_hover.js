const fs = require('fs');
let c = fs.readFileSync('frontend/jobs.html', 'utf8');

c = c.replace(
  '.job-card:hover { box-shadow: var(--shadow); border-color: rgba(201,168,76,0.35); transform: translateX(4px); }',
  '.job-card:hover { box-shadow: 0 8px 32px rgba(201,168,76,0.15), 0 2px 8px rgba(0,0,0,0.08); border-color: rgba(201,168,76,0.5); transform: translateX(6px) translateY(-2px); }'
);

// Also improve job card transition
c = c.replace(
  '.job-card {',
  '.job-card { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); '
);

fs.writeFileSync('frontend/jobs.html', c, 'utf8');
console.log('Fixed:', c.includes('cubic-bezier'));