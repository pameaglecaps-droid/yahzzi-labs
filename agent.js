require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'agent.log'), line + '\n');
}

async function getShopifyProducts() {
  const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
  const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
  const { data } = await axios.get(`https://${store}/admin/api/2024-01/products.json`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    params: { limit: 10, fields: 'id,title,variants,body_html' }
  });
  return data.products || [];
}

async function createMetaCampaign(campaignData) {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/campaigns`;
  const { data } = await axios.post(url, null, {
    params: { access_token: META_ACCESS_TOKEN, ...campaignData }
  });
  return data;
}

async function generateCampaignStrategy(products, objective = 'CONVERSIONS') {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

  const prompt = `Você é um especialista em tráfego pago da Yahzzi Labs. Com base nos produtos abaixo, crie uma estratégia de campanha Meta Ads otimizada para conversões.

PRODUTOS:
${products.slice(0, 3).map(p => `- ${p.title}: $${p.variants?.[0]?.price || 'N/A'}`).join('\n')}

CONFIGURAÇÕES:
- Objetivo: ${objective}
- CPA Alvo: $${config.safety.targetCPA}
- ROAS Alvo: ${config.safety.targetROAS}
- Budget inicial sugerido: $${config.safety.minSpendToEvaluate * 2}/dia

Forneça:
1. Nome da campanha (max 50 chars)
2. Estrutura de adsets recomendada (3-5 adsets com targeting)
3. Tipos de criativos recomendados
4. Copy para 3 variações de anúncio (headline + texto)
5. Budget diário recomendado por adset

Responda em JSON estruturado.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  return message.content[0].text;
}

async function runCampaignAgent(objective = 'CONVERSIONS') {
  log('=== CAMPAIGN AGENT INICIANDO - Yahzzi Labs ===');

  let products = [];
  try {
    products = await getShopifyProducts();
    log(`Produtos Shopify carregados: ${products.length}`);
  } catch (e) {
    log(`Aviso: Não foi possível carregar produtos Shopify: ${e.message}`);
  }

  log('Gerando estratégia de campanha com Claude AI...');
  try {
    const strategy = await generateCampaignStrategy(products, objective);
    log('Estratégia gerada com sucesso');

    const reportFile = path.join(__dirname, 'logs', `campaign-strategy-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportFile, JSON.stringify({ timestamp: new Date().toISOString(), strategy }, null, 2));
    log(`Estratégia salva em: ${reportFile}`);

    console.log('\n=== ESTRATÉGIA DE CAMPANHA ===');
    console.log(strategy);

    return strategy;
  } catch (e) {
    log(`Erro ao gerar estratégia: ${e.message}`);
    throw e;
  }
}

const objective = process.argv[2] || 'CONVERSIONS';
runCampaignAgent(objective).catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
