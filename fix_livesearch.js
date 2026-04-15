const fs = require('fs');
let c = fs.readFileSync('frontend/jobs.html', 'utf8');

// Add debounce and live search - only modify the input's event
c = c.replace(
  `onkeydown="if(event.key==='Enter') doSearch()"`,
  `onkeydown="if(event.key==='Enter') doSearch()" oninput="debouncedSearch()"`
);

// Add debounced search function after doSearch
c = c.replace(
  'function doSearch() {',
  `let searchTimer;
function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(), 400);
}
function doSearch() {`
);

fs.writeFileSync('frontend/jobs.html', c, 'utf8');
console.log('Has debouncedSearch:', c.includes('debouncedSearch'));