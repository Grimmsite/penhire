// Add this route to server.js just before the wildcard route
// Health check for Render
app.get('/api/health', (req, res) => {
  const db = getDB();
  const jobs = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE is_active = 1').get().c;
  res.json({ status: 'ok', jobs, time: new Date().toISOString() });
});
