require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'traffic-manager.log'), line + '\n');
}

async function getMetaInsights(datePreset = 'last_7d') {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`;
  const { data } = await axios.get(url, {
    params: {
      access_token: META_ACCESS_TOKEN,
      fields: 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,cpc,cpm,ctr,frequency',
      date_preset: datePreset,
      level: 'adset',
      limit: 100
    }
  });
  return data.data || [];
}

async function getMetaCampaigns() {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/campaigns`;
  const { data } = await axios.get(url, {
    params: { access_token: META_ACCESS_TOKEN, fields: 'id,name,status,daily_budget,lifetime_budget', limit: 50 }
  });
  return data.data || [];
}

async function getAdsetBudget(adsetId) {
  const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${adsetId}`;
  const { data } = await axios.get(url, {
    params: { access_token: META_ACCESS_TOKEN, fields: 'daily_budget,bid_amount' }
  });
  return data;
}

async function updateAdsetBudget(adsetId, newBudgetCents) {
  const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${adsetId}`;
  const { data } = await axios.post(url, null, {
    params: { access_token: META_ACCESS_TOKEN, daily_budget: newBudgetCents }
  });
  return data;
}

async function pauseCampaign(campaignId) {
  const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${campaignId}`;
  const { data } = await axios.post(url, null, {
    params: { access_token: META_ACCESS_TOKEN, status: 'PAUSED' }
  });
  return data;
}

function calculateLeadMetrics(insight) {
  const spend = parseFloat(insight.spend || 0);
  const clicks = parseInt(insight.clicks || 0);
  const impressions = parseInt(insight.impressions || 0);
  const ctr = parseFloat(insight.ctr || 0);
  const frequency = parseFloat(insight.frequency || 0);
  const cpc = parseFloat(insight.cpc || 0);

  // Count leads: form submissions or messaging starts (WhatsApp clicks)
  const actions = insight.actions || [];
  const leadActions = ['lead', 'onsite_conversion.lead_grouped', 'contact_total', 'messaging_conversation_started_7d', 'click_to_call_call_confirm'];
  const leads = leadActions.reduce((sum, type) => {
    const a = actions.find(a => a.action_type === type);
    return sum + parseFloat(a?.value || 0);
  }, 0);

  const cpl = leads > 0 ? spend / leads : spend > 0 ? 999 : 0;
  const cpm = parseFloat(insight.cpm || 0);

  return { spend, clicks, impressions, leads, cpl, ctr, frequency, cpc, cpm };
}

async function runTrafficManager() {
  log('=== TRAFFIC MANAGER INICIANDO - Yahzzi Labs (Lead Gen / WhatsApp) ===');

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const safety = config.safety || {};
  const targetCPL = parseFloat(safety.targetCPL || process.env.TARGET_CPL || 8);
  const maxCPL = parseFloat(safety.maxCPL || targetCPL * 2.5);
  const killCPLMultiplier = parseFloat(safety.killCPLMultiplier || 2.5);
  const killSpendThreshold = parseFloat(safety.killSpendThreshold || 10);
  const autoScale = safety.autoScale !== false;
  const maxBudgetIncrease = parseFloat(safety.maxBudgetIncrease || 0.20);
  const maxBudgetChangesPerDay = parseInt(safety.maxBudgetChangesPerDay || 0);
  const scaleMinLeads = parseInt(safety.scaleMinLeads || 20);
  const scaleGoodCPL = parseFloat(safety.scaleGoodCPL || targetCPL * 0.6);
  const killFrequencyMax = parseFloat(safety.killFrequencyMax || 3.5);
  const maxDailyBudget = parseFloat(safety.maxDailyBudget || process.env.MAX_DAILY_BUDGET || 30);

  let insights7d, campaigns;
  try {
    [insights7d, campaigns] = await Promise.all([getMetaInsights('last_7d'), getMetaCampaigns()]);
    log(`Dados coletados: ${insights7d.length} adsets, ${campaigns.length} campanhas`);
  } catch (err) {
    log(`ERRO ao coletar dados Meta: ${err.message}`);
    return;
  }

  const actions = [];
  const alerts = [];
  let budgetChanges = 0;

  for (const insight of insights7d) {
    if (budgetChanges >= maxBudgetChangesPerDay) break;
    const m = calculateLeadMetrics(insight);
    const adsetName = insight.adset_name;
    const adsetId = insight.adset_id;
    const campaignName = insight.campaign_name;

    log(`Adset: ${adsetName} | Gasto: R$${m.spend.toFixed(2)} | Leads: ${m.leads} | CPL: R$${m.cpl.toFixed(2)} | Freq: ${m.frequency.toFixed(1)}`);

    // Scale up: only if autoScale enabled AND CPL is good with enough leads
    if (autoScale && maxBudgetChangesPerDay > 0 && m.leads >= scaleMinLeads && m.cpl <= scaleGoodCPL && m.spend > 20) {
      try {
        const adsetData = await getAdsetBudget(adsetId);
        const currentBudgetCents = parseInt(adsetData.daily_budget || 0);
        const newBudgetCents = Math.round(currentBudgetCents * (1 + maxBudgetIncrease));
        const maxBudgetCents = maxDailyBudget * 100;

        if (currentBudgetCents > 0 && newBudgetCents <= maxBudgetCents) {
          await updateAdsetBudget(adsetId, newBudgetCents);
          const msg = `ESCALONADO: ${adsetName} | CPL: R$${m.cpl.toFixed(2)} | Leads: ${m.leads} | Budget: +${(maxBudgetIncrease * 100).toFixed(0)}%`;
          actions.push(msg);
          log(msg);
          budgetChanges++;
        }
      } catch (e) {
        log(`Erro ao escalonar ${adsetName}: ${e.message}`);
      }
    } else if (!autoScale) {
      log(`Auto-escalonamento desativado para ${adsetName} — orçamento mantido no mínimo`);
    }

    // Kill: CPL too high after minimum spend threshold
    if (m.cpl > targetCPL * killCPLMultiplier && m.spend > killSpendThreshold) {
      const campaign = campaigns.find(c => c.id === insight.campaign_id);
      if (campaign && campaign.status === 'ACTIVE') {
        try {
          await pauseCampaign(campaign.id);
          const msg = `PAUSADO: ${campaignName} | CPL: R$${m.cpl.toFixed(2)} (limite: R$${(targetCPL * killCPLMultiplier).toFixed(2)}) | Gasto: R$${m.spend.toFixed(2)}`;
          actions.push(msg);
          alerts.push(msg);
          log(msg);
        } catch (e) {
          log(`Erro ao pausar ${campaignName}: ${e.message}`);
        }
      }
    }

    // CPL warning (between target and kill threshold)
    if (m.cpl > maxCPL && m.cpl <= targetCPL * killCPLMultiplier && m.spend > 20) {
      const msg = `ALERTA CPL ALTO: ${adsetName} | CPL: R$${m.cpl.toFixed(2)} (meta: R$${targetCPL.toFixed(2)})`;
      alerts.push(msg);
      log(msg);
    }

    // No leads yet with spend above kill threshold
    if (m.leads === 0 && m.spend > killSpendThreshold) {
      const msg = `SEM LEADS: ${adsetName} | Gasto: R$${m.spend.toFixed(2)} sem conversões — revisar criativo/público`;
      alerts.push(msg);
      log(msg);
    }

    // Frequency fatigue
    if (m.frequency > killFrequencyMax) {
      const msg = `FADIGA: ${adsetName} | Frequência: ${m.frequency.toFixed(1)} — Renovar criativos ou público`;
      alerts.push(msg);
      log(msg);
    }

    // CTR very low (below 0.5%)
    if (m.ctr < parseFloat(safety.killCTRThreshold || 0.5) && m.impressions > 10000) {
      const msg = `CTR BAIXO: ${adsetName} | CTR: ${m.ctr.toFixed(2)}% — Criativo com baixo engajamento`;
      alerts.push(msg);
      log(msg);
    }
  }

  // Today's totals
  let todayInsights = [];
  try { todayInsights = await getMetaInsights('today'); } catch {}

  const totalSpend = todayInsights.reduce((s, i) => s + parseFloat(i.spend || 0), 0);
  const totalLeads = todayInsights.reduce((s, i) => s + calculateLeadMetrics(i).leads, 0);
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const report = {
    timestamp: new Date().toISOString(),
    brand: 'Yahzzi Labs',
    model: 'lead_gen_whatsapp',
    totalSpend: totalSpend.toFixed(2),
    totalLeads,
    avgCPL: avgCPL.toFixed(2),
    targetCPL,
    activeCampaigns: campaigns.filter(c => c.status === 'ACTIVE').length,
    actions,
    alerts
  };

  const reportFile = path.join(__dirname, 'logs', `traffic-manager-report-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // Claude AI executive summary
  try {
    const prompt = `Você é o Traffic Manager AI da Yahzzi Labs, uma empresa de serviços que capta leads via Meta Ads → WhatsApp.

MODELO DE NEGÓCIO: Lead Generation → WhatsApp (sem e-commerce, sem Shopify, sem ROAS de produto)
KPI PRINCIPAL: CPL (Custo por Lead) — Meta: R$${targetCPL}

DADOS DE PERFORMANCE (7 dias):
${JSON.stringify(insights7d.slice(0, 8).map(i => {
  const m = calculateLeadMetrics(i);
  return { adset: i.adset_name, campanha: i.campaign_name, gasto: `R$${m.spend.toFixed(2)}`, leads: m.leads, cpl: `R$${m.cpl.toFixed(2)}`, ctr: `${m.ctr.toFixed(2)}%`, frequencia: m.frequency.toFixed(1) };
}), null, 2)}

AÇÕES EXECUTADAS:
${actions.length > 0 ? actions.join('\n') : 'Nenhuma ação necessária'}

ALERTAS:
${alerts.length > 0 ? alerts.join('\n') : 'Nenhum alerta'}

RESUMO DO DIA:
- Gasto total: R$${totalSpend.toFixed(2)}
- Leads gerados: ${totalLeads}
- CPL médio: R$${avgCPL.toFixed(2)} (meta: R$${targetCPL})
- Campanhas ativas: ${campaigns.filter(c => c.status === 'ACTIVE').length}

Gere um relatório executivo conciso em português com: (1) situação atual, (2) ações tomadas, (3) 3 próximos passos prioritários para melhorar o CPL e volume de leads.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const aiInsights = message.content[0].text;
    log('\n=== ANÁLISE AI ===');
    log(aiInsights);
    report.aiInsights = aiInsights;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  } catch (e) {
    log(`Erro ao gerar análise AI: ${e.message}`);
  }

  log(`=== TRAFFIC MANAGER CONCLUÍDO | Leads: ${totalLeads} | CPL médio: R$${avgCPL.toFixed(2)} | Ações: ${actions.length} | Alertas: ${alerts.length} ===`);
  return report;
}

runTrafficManager().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
