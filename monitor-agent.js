require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'monitor.log'), line + '\n');
}

async function collectMetaMetrics() {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`;
  const { data } = await axios.get(url, {
    params: {
      access_token: META_ACCESS_TOKEN,
      fields: 'spend,impressions,clicks,actions,cpc,cpm,ctr,frequency',
      date_preset: 'today',
      level: 'account'
    }
  });
  const d = data.data?.[0] || {};
  const spend = parseFloat(d.spend || 0);
  const actions = d.actions || [];

  // Count leads from all relevant action types
  const leadActionTypes = ['lead', 'onsite_conversion.lead_grouped', 'contact_total', 'messaging_conversation_started_7d', 'click_to_call_call_confirm'];
  const leads = leadActionTypes.reduce((sum, type) => {
    const a = actions.find(a => a.action_type === type);
    return sum + parseFloat(a?.value || 0);
  }, 0);

  const cpl = leads > 0 ? spend / leads : 0;

  return {
    spend: spend.toFixed(2),
    impressions: parseInt(d.impressions || 0),
    clicks: parseInt(d.clicks || 0),
    leads: Math.round(leads),
    cpl: cpl.toFixed(2),
    cpc: parseFloat(d.cpc || 0).toFixed(2),
    ctr: parseFloat(d.ctr || 0).toFixed(2),
    cpm: parseFloat(d.cpm || 0).toFixed(2),
    frequency: parseFloat(d.frequency || 0).toFixed(2)
  };
}

async function collectTikTokMetrics() {
  const { TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID } = process.env;
  if (!TIKTOK_ACCESS_TOKEN || !TIKTOK_ADVERTISER_ID) return null;
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data } = await axios.post('https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/', {
      advertiser_id: TIKTOK_ADVERTISER_ID,
      report_type: 'BASIC',
      dimensions: ['stat_time_day'],
      metrics: ['spend', 'impressions', 'clicks', 'conversions', 'cost_per_conversion', 'real_time_app_install'],
      data_level: 'AUCTION_ADVERTISER',
      start_date: today,
      end_date: today
    }, {
      headers: { 'Access-Token': TIKTOK_ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });
    const m = data.data?.list?.[0]?.metrics || {};
    return {
      spend: m.spend || '0',
      impressions: m.impressions || 0,
      clicks: m.clicks || 0,
      leads: m.conversions || 0,
      cpl: m.cost_per_conversion || '0'
    };
  } catch (e) {
    log(`TikTok erro: ${e.message}`);
    return null;
  }
}

async function checkAlerts(metrics, config) {
  const alerts = [];
  const safety = config.safety || {};
  const targetCPL = parseFloat(safety.targetCPL || process.env.TARGET_CPL || 8);
  const maxCPL = parseFloat(safety.maxCPL || targetCPL * 2.5);
  const maxDailyBudget = parseFloat(safety.maxDailyBudget || process.env.MAX_DAILY_BUDGET || 30);

  const metaSpend = parseFloat(metrics.meta?.spend || 0);
  const metaLeads = parseInt(metrics.meta?.leads || 0);
  const metaCPL = parseFloat(metrics.meta?.cpl || 0);
  const hour = new Date().getHours();

  // CPL too high
  if (metaCPL > maxCPL && metaLeads > 0) {
    alerts.push(`CPL ALTO: R$${metaCPL.toFixed(2)} (meta: R$${targetCPL} | máx: R$${maxCPL}) — ${metaLeads} leads hoje`);
  }

  // Budget limit
  if (metaSpend > maxDailyBudget * 0.9) {
    alerts.push(`ORÇAMENTO DIÁRIO: ${((metaSpend / maxDailyBudget) * 100).toFixed(0)}% utilizado — R$${metaSpend.toFixed(2)} de R$${maxDailyBudget}`);
  }

  // No leads during business hours
  if (metaLeads === 0 && metaSpend > 20 && hour >= 9 && hour <= 21) {
    alerts.push(`SEM LEADS hoje com R$${metaSpend.toFixed(2)} gasto — verificar campanhas e formulários`);
  }

  // Very low CTR
  const metaCTR = parseFloat(metrics.meta?.ctr || 0);
  if (metaCTR < 0.5 && parseInt(metrics.meta?.impressions || 0) > 5000) {
    alerts.push(`CTR BAIXO: ${metaCTR.toFixed(2)}% — criativos com baixo engajamento`);
  }

  // High frequency
  const metaFreq = parseFloat(metrics.meta?.frequency || 0);
  if (metaFreq > 3.5) {
    alerts.push(`FREQUÊNCIA ALTA: ${metaFreq.toFixed(1)} — fadiga de audiência, renovar criativos`);
  }

  return alerts;
}

async function runMonitor() {
  log('=== MONITOR INICIANDO - Yahzzi Labs (Lead Gen / WhatsApp) ===');

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const targetCPL = parseFloat(config.safety?.targetCPL || process.env.TARGET_CPL || 15);
  const metrics = { timestamp: new Date().toISOString(), brand: 'Yahzzi Labs', model: 'lead_gen_whatsapp' };

  await Promise.allSettled([
    collectMetaMetrics()
      .then(d => {
        metrics.meta = d;
        log(`Meta OK: Leads=${d.leads} | CPL=R$${d.cpl} | Gasto=R$${d.spend} | CTR=${d.ctr}%`);
      })
      .catch(e => log(`Meta ERRO: ${e.message}`)),

    collectTikTokMetrics()
      .then(d => {
        metrics.tiktok = d;
        if (d) log(`TikTok OK: Leads=${d.leads} | CPL=R$${d.cpl} | Gasto=R$${d.spend}`);
      })
      .catch(e => log(`TikTok ERRO: ${e.message}`))
  ]);

  const totalSpend = parseFloat(metrics.meta?.spend || 0) + parseFloat(metrics.tiktok?.spend || 0);
  const totalLeads = parseInt(metrics.meta?.leads || 0) + parseInt(metrics.tiktok?.leads || 0);
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

  metrics.totals = {
    totalSpend: totalSpend.toFixed(2),
    totalLeads,
    avgCPL: avgCPL.toFixed(2),
    targetCPL,
    cplStatus: avgCPL === 0 ? 'sem_dados' : avgCPL <= targetCPL ? 'ok' : avgCPL <= targetCPL * 1.5 ? 'alerta' : 'critico'
  };

  const alerts = await checkAlerts(metrics, config);
  metrics.alerts = alerts;
  if (alerts.length > 0) alerts.forEach(a => log(`ALERTA: ${a}`));

  // Save metrics
  const now = new Date();
  const filename = `metrics-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(metrics, null, 2));
  log(`Métricas salvas: ${filename}`);

  // AI analysis if alerts
  if (alerts.length > 0) {
    try {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Analise estes alertas do sistema Ad Traffic AI da Yahzzi Labs (modelo: Lead Gen → WhatsApp, KPI: CPL alvo R$${targetCPL}) e sugira ações imediatas:\n\n${alerts.join('\n')}\n\nMétricas: ${JSON.stringify(metrics.totals)}\n\nResposta concisa em português.`
        }]
      });
      metrics.aiAnalysis = message.content[0].text;
      log(`Análise AI: ${metrics.aiAnalysis}`);
    } catch (e) {
      log(`Erro análise AI: ${e.message}`);
    }
  }

  log(`=== MONITOR CONCLUÍDO | Leads=${totalLeads} | CPL=R$${avgCPL.toFixed(2)} | Gasto=R$${totalSpend.toFixed(2)} | Alertas=${alerts.length} ===`);
  return metrics;
}

runMonitor().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
