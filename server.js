require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const winston = require('winston');

const app = express();
const PORT = process.env.PORT || 3001;

// Logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/server.log', maxsize: 5242880, maxFiles: 5 })
  ]
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load config
function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    brand: process.env.BRAND_NAME || 'Yahzzi Labs',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ─────────────────────────────────────────
// META ADS
// ─────────────────────────────────────────
app.get('/api/meta/campaigns', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/campaigns`;
    const { data } = await axios.get(url, {
      params: { access_token: META_ACCESS_TOKEN, fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time', limit: 50 }
    });
    res.json(data);
  } catch (err) {
    logger.error(`Meta campaigns error: ${err.message}`);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

app.get('/api/meta/insights', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const { date_preset = 'last_7d', level = 'campaign' } = req.query;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`;
    const { data } = await axios.get(url, {
      params: {
        access_token: META_ACCESS_TOKEN,
        fields: 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,cpc,cpm,ctr,frequency,reach',
        date_preset,
        level,
        limit: 100
      }
    });
    res.json(data);
  } catch (err) {
    logger.error(`Meta insights error: ${err.message}`);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

app.get('/api/meta/insights/today', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`;
    const { data } = await axios.get(url, {
      params: {
        access_token: META_ACCESS_TOKEN,
        fields: 'spend,impressions,clicks,actions,action_values,cpc,cpm,ctr',
        date_preset: 'today',
        level: 'account'
      }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meta/adsets', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/adsets`;
    const { data } = await axios.get(url, {
      params: { access_token: META_ACCESS_TOKEN, fields: 'id,name,status,daily_budget,bid_amount,optimization_goal,campaign_id', limit: 100 }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meta/adsets/:adsetId/budget', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
    const { adsetId } = req.params;
    const { daily_budget } = req.body;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${adsetId}`;
    const { data } = await axios.post(url, null, {
      params: { access_token: META_ACCESS_TOKEN, daily_budget: Math.round(daily_budget * 100) }
    });
    logger.info(`Budget updated: adset=${adsetId} budget=$${daily_budget}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meta/campaigns/:campaignId/pause', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
    const { campaignId } = req.params;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${campaignId}`;
    const { data } = await axios.post(url, null, {
      params: { access_token: META_ACCESS_TOKEN, status: 'PAUSED' }
    });
    logger.info(`Campaign paused: ${campaignId}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meta/campaigns/:campaignId/activate', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
    const { campaignId } = req.params;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${campaignId}`;
    const { data } = await axios.post(url, null, {
      params: { access_token: META_ACCESS_TOKEN, status: 'ACTIVE' }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meta/pixel/events', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_PIXEL_ID_BR, META_API_VERSION = 'v20.0' } = process.env;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID_BR}/stats`;
    const { data } = await axios.get(url, {
      params: { access_token: META_ACCESS_TOKEN, start_time: Math.floor(Date.now() / 1000) - 86400 }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/meta/account', async (req, res) => {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}`;
    const { data } = await axios.get(url, {
      params: { access_token: META_ACCESS_TOKEN, fields: 'name,account_status,currency,timezone_name,spend_cap,amount_spent' }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// TIKTOK ADS
// ─────────────────────────────────────────
app.get('/api/tiktok/campaigns', async (req, res) => {
  try {
    const { TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID } = process.env;
    const { data } = await axios.get('https://business-api.tiktok.com/open_api/v1.3/campaign/get/', {
      headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN },
      params: { advertiser_id: TIKTOK_ADVERTISER_ID, fields: JSON.stringify(['campaign_id','campaign_name','status','budget','budget_mode','objective_type']) }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tiktok/insights', async (req, res) => {
  try {
    const { TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID } = process.env;
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data } = await axios.post('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      advertiser_id: TIKTOK_ADVERTISER_ID,
      report_type: 'BASIC',
      dimensions: ['campaign_id'],
      metrics: ['spend','impressions','clicks','conversions','cost_per_conversion','ctr','cpc'],
      data_level: 'AUCTION_CAMPAIGN',
      start_date: weekAgo,
      end_date: today,
      page_size: 100
    }, {
      headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tiktok/health', async (req, res) => {
  try {
    const { TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID } = process.env;
    const { data } = await axios.post('https://business-api.tiktok.com/open_api/v1.3/advertiser/info/', {
      advertiser_ids: [TIKTOK_ADVERTISER_ID]
    }, {
      headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });
    res.json({ ok: data.code === 0, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SHOPIFY
// ─────────────────────────────────────────
app.get('/api/shopify/orders', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const { status = 'any', limit = 50, created_at_min } = req.query;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const params = { status, limit };
    if (created_at_min) params.created_at_min = created_at_min;
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/orders.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
      params
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shopify/orders/today', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/orders.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
      params: { status: 'any', limit: 250, created_at_min: today.toISOString(), financial_status: 'paid' }
    });
    const orders = data.orders || [];
    const revenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
    res.json({ orders: orders.length, revenue: revenue.toFixed(2), avgOrderValue: orders.length ? (revenue / orders.length).toFixed(2) : '0.00', orders_data: orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shopify/customers', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/customers.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
      params: { limit: 250 }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shopify/products', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/products.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
      params: { limit: 50, fields: 'id,title,variants,images,status' }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shopify/shop', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shopify/abandoned-checkouts', async (req, res) => {
  try {
    const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
    const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await axios.get(`https://${store}/admin/api/2024-01/checkouts.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
      params: { limit: 100, created_at_min: since }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// STRIPE
// ─────────────────────────────────────────
app.get('/api/stripe/balance', async (req, res) => {
  try {
    const { STRIPE_SECRET_KEY } = process.env;
    const { data } = await axios.get('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` }
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stripe/charges/today', async (req, res) => {
  try {
    const { STRIPE_SECRET_KEY } = process.env;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await axios.get('https://api.stripe.com/v1/charges', {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      params: { 'created[gte]': Math.floor(today.getTime() / 1000), limit: 100 }
    });
    const charges = data.data || [];
    const successful = charges.filter(c => c.status === 'succeeded');
    const revenue = successful.reduce((sum, c) => sum + c.amount, 0) / 100;
    const refunds = charges.filter(c => c.refunded).length;
    res.json({ total: charges.length, successful: successful.length, revenue: revenue.toFixed(2), refunds, successRate: charges.length ? ((successful.length / charges.length) * 100).toFixed(1) : '0' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error(`Stripe webhook error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  logger.info(`Stripe event: ${event.type}`);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    logger.info(`Payment completed: ${session.id} - $${(session.amount_total / 100).toFixed(2)}`);
  }
  res.json({ received: true });
});

// ─────────────────────────────────────────
// GOOGLE STITCH
// ─────────────────────────────────────────
app.get('/api/stitch/status', (req, res) => {
  const config = getConfig();
  const stitchConfig = config.google?.stitch || {};
  res.json({
    enabled: stitchConfig.enabled || false,
    projectId: stitchConfig.projectId || null,
    hasApiKey: !!process.env.STITCH_API_KEY,
    screensDir: '/stitch-screens'
  });
});

app.get('/api/stitch/screens', (req, res) => {
  try {
    const screensDir = require('path').join(__dirname, 'public', 'stitch-screens');
    if (!require('fs').existsSync(screensDir)) return res.json({ screens: [] });
    const files = require('fs').readdirSync(screensDir)
      .filter(f => f.endsWith('.html'))
      .map(f => ({
        filename: f,
        url: `/stitch-screens/${f}`,
        createdAt: require('fs').statSync(require('path').join(screensDir, f)).mtime
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ screens: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stitch/generate', async (req, res) => {
  try {
    const config = getConfig();
    if (!config.google?.stitch?.enabled) {
      return res.status(400).json({ error: 'Google Stitch está desabilitado. Ative em config.json (google.stitch.enabled: true).' });
    }
    if (!process.env.STITCH_API_KEY) {
      return res.status(400).json({ error: 'STITCH_API_KEY não configurada nas variáveis de ambiente.' });
    }
    const { type = 'lead', campaignName, target } = req.body;
    const args = ['stitch-agent.js', type];
    if (campaignName) args.push(campaignName);
    if (target) args.push(target);
    const { spawn } = require('child_process');
    const proc = spawn('node', args, { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info(`Stitch agent triggered: type=${type}`);
    res.json({ ok: true, message: `Stitch agent iniciado (tipo: ${type}). Verifique /api/stitch/screens em alguns instantes.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/stitch/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['stitch-agent.js'], { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info('Stitch agent triggered manually');
    res.json({ ok: true, message: 'Stitch agent iniciado. Verifique os logs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// DASHBOARD METRICS (consolidated)
// ─────────────────────────────────────────
app.get('/api/dashboard/summary', async (req, res) => {
  const result = { meta: null, tiktok: null, timestamp: new Date().toISOString() };
  const errors = [];

  const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'contact_total', 'messaging_conversation_started_7d', 'click_to_call_call_confirm'];

  await Promise.allSettled([
    // Meta today — lead gen model
    axios.get(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v20.0'}/${process.env.META_AD_ACCOUNT_ID}/insights`, {
      params: {
        access_token: process.env.META_ACCESS_TOKEN,
        fields: 'spend,impressions,clicks,actions,cpc,cpm,ctr,frequency',
        date_preset: 'today',
        level: 'account'
      }
    }).then(r => {
      const d = r.data.data?.[0] || {};
      const spend = parseFloat(d.spend || 0);
      const actions = d.actions || [];
      const leads = LEAD_ACTION_TYPES.reduce((s, t) => {
        const a = actions.find(a => a.action_type === t);
        return s + parseFloat(a?.value || 0);
      }, 0);
      const cpl = leads > 0 ? spend / leads : 0;
      result.meta = {
        spend: spend.toFixed(2),
        impressions: d.impressions || 0,
        clicks: d.clicks || 0,
        leads: Math.round(leads),
        cpl: cpl.toFixed(2),
        cpc: parseFloat(d.cpc || 0).toFixed(2),
        cpm: parseFloat(d.cpm || 0).toFixed(2),
        ctr: parseFloat(d.ctr || 0).toFixed(2),
        frequency: parseFloat(d.frequency || 0).toFixed(2)
      };
    }).catch(e => errors.push(`meta: ${e.message}`)),

    // TikTok today (optional)
    (async () => {
      const { TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID } = process.env;
      if (!TIKTOK_ACCESS_TOKEN || !TIKTOK_ADVERTISER_ID) return;
      const today = new Date().toISOString().split('T')[0];
      const r = await axios.post('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
        advertiser_id: TIKTOK_ADVERTISER_ID,
        report_type: 'BASIC',
        dimensions: ['stat_time_day'],
        metrics: ['spend', 'impressions', 'clicks', 'conversions', 'cost_per_conversion'],
        data_level: 'AUCTION_ADVERTISER',
        start_date: today,
        end_date: today
      }, { headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
      const m = r.data.data?.list?.[0]?.metrics || {};
      result.tiktok = { spend: m.spend || '0', leads: m.conversions || 0, cpl: m.cost_per_conversion || '0', impressions: m.impressions || 0, clicks: m.clicks || 0 };
    })().catch(e => errors.push(`tiktok: ${e.message}`))
  ]);

  if (errors.length) result.errors = errors;
  res.json(result);
});

// ─────────────────────────────────────────
// METRICS HISTORY
// ─────────────────────────────────────────
app.get('/api/metrics/history', (req, res) => {
  try {
    const dataDir = path.join(__dirname, 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('metrics-')).sort().slice(-30);
    const history = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return null; }
    }).filter(Boolean);
    res.json(history);
  } catch {
    res.json([]);
  }
});

app.post('/api/metrics/save', (req, res) => {
  try {
    const now = new Date();
    const filename = `metrics-${now.toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(__dirname, 'data', filename), JSON.stringify(req.body, null, 2));
    res.json({ ok: true, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// AGENT LOGS
// ─────────────────────────────────────────
app.get('/api/logs/:agent', (req, res) => {
  try {
    const logFile = path.join(__dirname, 'logs', `${req.params.agent}.log`);
    if (!fs.existsSync(logFile)) return res.json({ lines: [] });
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-100);
    res.json({ lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  try {
    const logsDir = path.join(__dirname, 'logs');
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────
app.get('/api/config', (req, res) => {
  try {
    const config = getConfig();
    // Never return secrets in config endpoint
    const safe = JSON.parse(JSON.stringify(config));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config/safety', (req, res) => {
  try {
    const config = getConfig();
    config.safety = { ...config.safety, ...req.body };
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    res.json({ ok: true, safety: config.safety });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// AGENT TRIGGERS (manual run)
// ─────────────────────────────────────────
app.post('/api/agents/traffic-manager/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['traffic-manager-agent.js'], { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info('Traffic Manager agent triggered manually');
    res.json({ ok: true, message: 'Traffic Manager iniciado. Verifique os logs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/monitor/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['monitor-agent.js'], { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info('Monitor agent triggered manually');
    res.json({ ok: true, message: 'Monitor iniciado. Verifique os logs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/email/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['email-agent.js'], { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info('Email agent triggered manually');
    res.json({ ok: true, message: 'Email agent iniciado. Verifique os logs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/creative/run', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const proc = spawn('node', ['creative-agent.js'], { detached: true, stdio: 'ignore' });
    proc.unref();
    logger.info('Creative agent triggered manually');
    res.json({ ok: true, message: 'Creative Optimizer iniciado. Verifique os logs.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// DASHBOARD (SPA fallback)
// ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  logger.info(`Ad Traffic AI - Yahzzi Labs | Servidor rodando na porta ${PORT}`);
  logger.info(`Dashboard: http://localhost:${PORT}`);
});

// ─── RELATÓRIOS AUTOMÁTICOS 2x AO DIA ────────────────────────────────────────
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'pam.eaglecaps@gmail.com';
const SMTP_USER   = process.env.SMTP_USER;
const SMTP_PASS   = process.env.SMTP_PASS;

async function gerarRelatorio(turno) {
  try {
    const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
    const BASE = `https://graph.facebook.com/${META_API_VERSION}`;
    const today = new Date().toISOString().split('T')[0];

    // Campanhas ativas
    const camps = await axios.get(`${BASE}/${META_AD_ACCOUNT_ID}/campaigns`, {
      params: { fields: 'id,name,status,objective', limit: 10, access_token: META_ACCESS_TOKEN }
    });
    const ativas = camps.data.data.filter(c => c.status === 'ACTIVE');

    // Insights do dia
    const insights = await axios.get(`${BASE}/${META_AD_ACCOUNT_ID}/insights`, {
      params: {
        fields: 'spend,impressions,clicks,ctr,cpc,actions',
        time_range: JSON.stringify({ since: today, until: today }),
        access_token: META_ACCESS_TOKEN,
      }
    });
    const d = insights.data.data[0] || {};
    const leads = (d.actions || []).find(a => a.action_type === 'lead')?.value || 0;
    const mensagens = (d.actions || []).find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d')?.value || 0;

    const corpo = `
RELATÓRIO YAHZZI LABS — ${turno.toUpperCase()} | ${today}
${'─'.repeat(50)}

INVESTIMENTO HOJE : R$${parseFloat(d.spend || 0).toFixed(2)}
IMPRESSÕES        : ${parseInt(d.impressions || 0).toLocaleString('pt-BR')}
CLIQUES           : ${d.clicks || 0}
CTR               : ${parseFloat(d.ctr || 0).toFixed(2)}%
CPC               : R$${parseFloat(d.cpc || 0).toFixed(2)}
LEADS             : ${leads}
CONVERSAS WHATS   : ${mensagens}

CAMPANHAS ATIVAS  : ${ativas.length}
${ativas.map(c => `  • ${c.name}`).join('\n')}

${'─'.repeat(50)}
Yahzzi Labs — Ad Traffic AI
    `.trim();

    logger.info(`[CRON] Relatório ${turno} gerado`);

    if (SMTP_USER && SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      await transporter.sendMail({
        from: `"Yahzzi Labs AI" <${SMTP_USER}>`,
        to: ALERT_EMAIL,
        subject: `📊 Relatório ${turno} — Yahzzi Labs | ${today}`,
        text: corpo,
      });
      logger.info(`[CRON] Email enviado para ${ALERT_EMAIL}`);
    } else {
      // Sem SMTP: salva no log
      logger.info(`[CRON] RELATÓRIO:\n${corpo}`);
    }
  } catch (err) {
    logger.error(`[CRON] Erro ao gerar relatório ${turno}: ${err.message}`);
  }
}

// 8h BRT = 11h UTC | 18h BRT = 21h UTC
cron.schedule('0 11 * * *', () => gerarRelatorio('manhã'),  { timezone: 'America/Sao_Paulo' });
cron.schedule('0 21 * * *', () => gerarRelatorio('tarde'),  { timezone: 'America/Sao_Paulo' });

logger.info('[CRON] Relatórios automáticos agendados: 8h e 18h (horário de Brasília)');

module.exports = app;
