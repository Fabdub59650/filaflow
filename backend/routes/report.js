// Rapport hebdomadaire par e-mail : aperçu, envoi immédiat, état
const router = require('express').Router();
const weekly = require('../weekly-report');

router.get('/weekly/status', async (req, res) => {
  try { res.json(await weekly.status()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/weekly/preview', async (req, res) => {
  try { const r = await weekly.build(); res.json({ subject: r.subject, html: r.html, alerts: r.alerts }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/weekly/send', async (req, res) => {
  try { const r = await weekly.sendReport(); res.json({ ok: true, to: r.to, alerts: r.alerts }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
