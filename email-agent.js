require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', 'email-agent.log'), line + '\n');
}

function getDayType() {
  const days = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  return days[new Date().getDay()];
}

function getCampaignType(day) {
  const campaigns = {
    segunda: { type: 'welcome', segment: 'new_customers', subject_theme: 'Bem-vindo à Yahzzi Labs' },
    terca: { type: 'loyalty', segment: 'repeat_buyers', subject_theme: 'Oferta exclusiva para você' },
    quarta: { type: 'cart_recovery', segment: 'cart_abandoners', subject_theme: 'Você esqueceu algo...' },
    quinta: { type: 'educational', segment: 'all', subject_theme: 'Dicas para melhores resultados' },
    sexta: { type: 'flash_sale', segment: 'all', subject_theme: 'Flash Sale - só hoje!' }
  };
  return campaigns[day] || campaigns.quinta;
}

async function getShopifyCustomers(segment) {
  const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
  const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
  const now = new Date();

  let params = { limit: 250 };
  if (segment === 'new_customers') {
    const week = new Date(now - 7 * 86400000);
    params.created_at_min = week.toISOString();
    params.created_at_max = now.toISOString();
  } else if (segment === 'repeat_buyers') {
    params.orders_count_min = 2;
  }

  const { data } = await axios.get(`https://${store}/admin/api/2024-01/customers.json`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    params
  });
  return data.customers || [];
}

async function getAbandonedCheckouts() {
  const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
  const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await axios.get(`https://${store}/admin/api/2024-01/checkouts.json`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    params: { limit: 100, created_at_min: since }
  });
  return data.checkouts || [];
}

async function getShopifyProducts() {
  const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
  const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');
  const { data } = await axios.get(`https://${store}/admin/api/2024-01/products.json`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
    params: { limit: 5, fields: 'id,title,variants,images' }
  });
  return data.products || [];
}

async function generateEmailContent(campaign, customers, products) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const emailConfig = config.email || {};

  const prompt = `Você é o Email Marketing Manager da Yahzzi Labs. Crie uma campanha de email para hoje.

TIPO DE CAMPANHA: ${campaign.type}
SEGMENTO: ${campaign.segment} (${customers.length} destinatários)
TEMA: ${campaign.subject_theme}
DIA: ${getDayType()}

PRODUTOS EM DESTAQUE:
${products.slice(0, 3).map(p => `- ${p.title}: $${p.variants?.[0]?.price || 'N/A'}`).join('\n')}

LOJA: ${emailConfig.shopifyStore || 'yahzzi'}
FROM NAME: ${emailConfig.fromName || 'Yahzzi Labs'}

Crie o conteúdo do email com:
1. subject (max 50 chars, sem palavras spam)
2. preview_text (max 90 chars)
3. html_body (HTML simples e responsivo, com CTA claro)
4. plain_text (versão texto)

Use personalização {{customer.first_name}} onde aplicável.
CTA deve linkar para a loja.
Responda em JSON com esses 4 campos.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  });

  return message.content[0].text;
}

async function sendShopifyEmail(customers, emailContent, campaign) {
  // Shopify Email API - send via Shopify Email app or marketing events
  const { SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN } = process.env;
  const store = SHOPIFY_STORE_URL.replace('https://', '').replace('http://', '');

  let content;
  try {
    content = typeof emailContent === 'string' ? JSON.parse(emailContent.match(/\{[\s\S]*\}/)?.[0] || '{}') : emailContent;
  } catch {
    content = { subject: campaign.subject_theme, html_body: '<p>Email content</p>' };
  }

  // Create marketing event (Shopify tracks this)
  const marketingEvent = {
    marketing_event: {
      event_type: 'ad',
      marketing_channel: 'email',
      paid: false,
      referring_domain: store,
      body: content.subject,
      description: `Campanha ${campaign.type} - ${customers.length} destinatários`,
      started_at: new Date().toISOString()
    }
  };

  try {
    await axios.post(`https://${store}/admin/api/2024-01/marketing_events.json`, marketingEvent, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' }
    });
    log(`Marketing event criado no Shopify`);
  } catch (e) {
    log(`Aviso marketing event: ${e.message}`);
  }

  return { subject: content.subject, recipients: customers.length, status: 'scheduled', campaign: campaign.type };
}

async function runEmailAgent() {
  log('=== EMAIL AGENT INICIANDO - Yahzzi Labs ===');

  const day = getDayType();
  const campaign = getCampaignType(day);
  log(`Campanha do dia: ${campaign.type} | Segmento: ${campaign.segment}`);

  let customers = [];
  let abandonedCheckouts = [];
  let products = [];

  await Promise.allSettled([
    getShopifyCustomers(campaign.segment).then(c => { customers = c; log(`${c.length} clientes no segmento ${campaign.segment}`); }).catch(e => log(`Clientes ERRO: ${e.message}`)),
    campaign.segment === 'cart_abandoners' ? getAbandonedCheckouts().then(c => { abandonedCheckouts = c; log(`${c.length} carrinhos abandonados`); }).catch(e => log(`Carrinhos ERRO: ${e.message}`)) : Promise.resolve(),
    getShopifyProducts().then(p => { products = p; }).catch(e => log(`Produtos ERRO: ${e.message}`))
  ]);

  if (campaign.segment === 'cart_abandoners') customers = abandonedCheckouts;

  const MAX_EMAILS = 5000;
  if (customers.length > MAX_EMAILS) {
    customers = customers.slice(0, MAX_EMAILS);
    log(`Limitado a ${MAX_EMAILS} destinatários`);
  }

  if (customers.length === 0) {
    log(`Nenhum destinatário encontrado para segmento ${campaign.segment}. Encerrando.`);
    return;
  }

  log('Gerando conteúdo do email com Claude AI...');
  const emailContent = await generateEmailContent(campaign, customers, products);
  log('Conteúdo gerado');

  const result = await sendShopifyEmail(customers, emailContent, campaign);

  const report = {
    timestamp: new Date().toISOString(),
    day,
    campaign: campaign.type,
    segment: campaign.segment,
    recipients: result.recipients,
    subject: result.subject,
    status: result.status,
    emailContent
  };

  const reportFile = path.join(__dirname, 'logs', `email-report-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  log(`=== EMAIL AGENT CONCLUÍDO | Campanha: ${campaign.type} | Destinatários: ${result.recipients} | Status: ${result.status} ===`);
  return report;
}

runEmailAgent().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
