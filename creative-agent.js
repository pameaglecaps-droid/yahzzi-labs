require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'creative-agent.log'), line + '\n');
}

async function getTopPerformingAds() {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`;
  const { data } = await axios.get(url, {
    params: {
      access_token: META_ACCESS_TOKEN,
      fields: 'ad_name,ad_id,spend,impressions,clicks,actions,action_values,ctr',
      date_preset: 'last_30d',
      level: 'ad',
      sort: 'spend_descending',
      limit: 20
    }
  });
  return data.data || [];
}

async function generateCreatives(topAds, productContext = '') {
  const prompt = `Você é um especialista em copywriting e criativos para anúncios da Yahzzi Labs.

TOP ADS DE MELHOR PERFORMANCE (últimos 30 dias):
${topAds.slice(0, 5).map(ad => {
  const purchases = (ad.actions || []).find(a => a.action_type === 'purchase');
  const revenue = (ad.action_values || []).find(a => a.action_type === 'purchase');
  const spend = parseFloat(ad.spend || 0);
  const rev = parseFloat(revenue?.value || 0);
  return `- ${ad.ad_name}: ROAS ${spend > 0 ? (rev/spend).toFixed(2) : 'N/A'} | CTR ${ad.ctr}%`;
}).join('\n')}

${productContext ? `CONTEXTO DO PRODUTO:\n${productContext}` : ''}

Com base nos padrões dos anúncios de melhor performance, crie 5 variações de criativos novos:

Para cada variação forneça:
1. **Headline** (max 40 chars)
2. **Texto principal** (max 125 chars)
3. **Descrição** (max 30 chars)
4. **CTA** (SHOP_NOW / LEARN_MORE / ORDER_NOW)
5. **Tipo de imagem/vídeo recomendado**
6. **Hook de vídeo** (primeiros 3 segundos se aplicável)

Foque em: urgência, prova social, benefícios claros, e evitar gatilhos de spam.
Responda em JSON com array "creatives".`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  return message.content[0].text;
}

async function runCreativeAgent() {
  log('=== CREATIVE AGENT INICIANDO - Yahzzi Labs ===');

  let topAds = [];
  try {
    topAds = await getTopPerformingAds();
    log(`${topAds.length} anúncios de performance coletados`);
  } catch (e) {
    log(`Aviso: ${e.message}`);
  }

  const productContext = process.argv[2] || '';

  log('Gerando novos criativos com Claude AI...');
  const creatives = await generateCreatives(topAds, productContext);

  const reportFile = path.join(__dirname, 'logs', `creatives-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({ timestamp: new Date().toISOString(), topAds: topAds.length, creatives }, null, 2));

  console.log('\n=== NOVOS CRIATIVOS GERADOS ===');
  console.log(creatives);
  log('Creative Agent concluído');

  return creatives;
}

runCreativeAgent().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
