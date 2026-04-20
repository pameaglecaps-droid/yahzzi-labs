require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const {
  META_ACCESS_TOKEN,
  META_PAGE_ACCESS_TOKEN,
  META_AD_ACCOUNT_ID,
  META_API_VERSION = 'v20.0',
  META_PAGE_ID,
  WHATSAPP_LINK,
  WHATSAPP_NUMBER,
} = process.env;

const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(path.join(__dirname, 'logs'))) {
      fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
    }
    fs.appendFileSync(path.join(__dirname, 'logs', 'campaign-creation.log'), line + '\n');
  } catch {}
}

async function metaPost(endpoint, data, usePageToken = false) {
  try {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE}/${endpoint}`;
    const token = usePageToken ? (META_PAGE_ACCESS_TOKEN || META_ACCESS_TOKEN) : META_ACCESS_TOKEN;
    const res = await axios.post(url, null, {
      params: { ...data, access_token: token },
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.error;
    const msg = detail ? `[${detail.code}] ${detail.message}` : err.message;
    throw new Error(`Meta API (${endpoint}): ${msg}`);
  }
}

// ─── STEP 1: Lead Form ───────────────────────────────────────────────────────
async function createLeadForm() {
  log('Criando formulário de captação...');

  const waText = encodeURIComponent(
    'Acabei de preencher o formulário e quero criar minha marca própria. Pode me ajudar?'
  );
  const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${waText}`;

  const questions = JSON.stringify([
    { type: 'FULL_NAME' },
    {
      type: 'CUSTOM',
      label: 'Você deseja ter marca própria de quais produtos?',
      key: 'produtos_desejados',
      options: [
        { value: 'Suplementos alimentares', key: 'suplementos' },
        { value: 'Cosméticos', key: 'cosmeticos' },
        { value: 'Gummies', key: 'gummies' },
        { value: 'Cápsulas', key: 'capsulas' },
        { value: 'Solúveis', key: 'soluveis' },
        { value: 'Chocolates funcionais', key: 'chocolates' },
        { value: 'Caramelos', key: 'caramelos' },
      ],
    },
    {
      type: 'CUSTOM',
      label: 'Hoje, em qual ramo você atua?',
      key: 'ramo_atuacao',
    },
    {
      type: 'CUSTOM',
      label: 'Você já trabalha com marca própria?',
      key: 'tem_marca_propria',
      options: [
        { value: 'Sim', key: 'sim' },
        { value: 'Não', key: 'nao' },
      ],
    },
    {
      type: 'CUSTOM',
      label: 'Se sim, qual é sua marca hoje?',
      key: 'marca_atual',
    },
    {
      type: 'CUSTOM',
      label: 'Você teria pelo menos R$5.000 disponíveis (dinheiro ou crédito) para iniciar?',
      key: 'budget_disponivel',
      options: [
        { value: 'Sim', key: 'sim' },
        { value: 'Não', key: 'nao' },
        { value: 'Talvez', key: 'talvez' },
      ],
    },
    {
      type: 'CUSTOM',
      label: 'Se você já possui um projeto, qual o tamanho dele hoje?',
      key: 'tamanho_projeto',
    },
    {
      type: 'CUSTOM',
      label: 'Em qual estado você está hoje?',
      key: 'estado',
    },
    {
      type: 'CUSTOM',
      label: 'Se você já vende, em quais canais você atua?',
      key: 'canais_venda',
      options: [
        { value: 'Instagram', key: 'instagram' },
        { value: 'TikTok', key: 'tiktok' },
        { value: 'Facebook', key: 'facebook' },
        { value: 'Google', key: 'google' },
        { value: 'E-commerce próprio', key: 'ecommerce' },
        { value: 'Marketplaces', key: 'marketplaces' },
        { value: 'Loja física', key: 'loja_fisica' },
        { value: 'Distribuição', key: 'distribuicao' },
      ],
    },
    {
      type: 'CUSTOM',
      label: 'Qual seu objetivo com marca própria?',
      key: 'objetivo',
      options: [
        { value: 'Aumentar margem', key: 'margem' },
        { value: 'Escalar vendas', key: 'escalar' },
        { value: 'Criar um ativo', key: 'ativo' },
        { value: 'Entrar em novo mercado', key: 'novo_mercado' },
        { value: 'Outro', key: 'outro' },
      ],
    },
  ]);

  const result = await metaPost(`${META_PAGE_ID}/leadgen_forms`, {
    name: 'Aplicação – Criação de Marca Própria | Yahzzi Labs',
    questions,
    privacy_policy: JSON.stringify({
      url: waUrl,
      link_text: 'Política de Privacidade',
    }),
    thank_you_page: JSON.stringify({
      title: 'Redirecionando para o WhatsApp…',
      body: 'Aguarde, você será redirecionado em instantes.',
      button_type: 'VIEW_WEBSITE',
      website_url: waUrl,
    }),
    locale: 'pt_BR',
    block_display_for_non_targeted_viewer: false,
  }, false); // usa user token com ads_management

  log(`✅ Lead Form criado: ${result.id}`);
  return result.id;
}

// ─── STEP 2: Campaign ────────────────────────────────────────────────────────
async function createCampaign() {
  log('Criando campanha...');

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/campaigns`, {
    name: 'Yahzzi Labs | Marca Própria | Lead Gen | 2026',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: '[]',
  });

  log(`✅ Campanha criada: ${result.id}`);
  return result.id;
}

// ─── STEP 3: Ad Set ──────────────────────────────────────────────────────────
async function createAdSet(campaignId) {
  log('Criando conjunto de anúncios...');

  const targeting = JSON.stringify({
    geo_locations: { countries: ['BR'] },
    age_min: 22,
    age_max: 55,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'reels', 'story'],
    instagram_positions: ['stream', 'reels', 'story'],
  });

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adsets`, {
    name: 'Yahzzi | Brasil Amplo | 22-55 | Menor Custo',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: 3000, // R$30,00 em centavos
    targeting,
    promoted_object: JSON.stringify({ page_id: META_PAGE_ID }),
    destination_type: 'ON_AD',
    status: 'PAUSED',
  });

  log(`✅ Ad Set criado: ${result.id}`);
  return result.id;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 YAHZZI LABS — CRIAÇÃO DE CAMPANHA META ADS\n');
  log('=== INÍCIO DA CRIAÇÃO ===');

  // Validações
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID || !META_PAGE_ID) {
    console.error('❌ Variáveis META_ACCESS_TOKEN, META_AD_ACCOUNT_ID e META_PAGE_ID são obrigatórias no .env');
    process.exit(1);
  }

  try {
    const leadFormId = await createLeadForm();
    const campaignId = await createCampaign();
    const adSetId    = await createAdSet(campaignId);

    const summary = {
      leadFormId,
      campaignId,
      adSetId,
      createdAt: new Date().toISOString(),
      status: 'PAUSED — aguardando criativo (imagem ou vídeo)',
      nextStep: 'node add-creative.js --image <URL_ou_hash> OU --video <video_id>',
    };

    fs.writeFileSync(
      path.join(__dirname, 'campaign-ids.json'),
      JSON.stringify(summary, null, 2)
    );

    log('=== CRIAÇÃO CONCLUÍDA ===');

    console.log('\n✅ TUDO CRIADO COM SUCESSO!\n');
    console.log('──────────────────────────────────────────');
    console.log(`📋 Lead Form ID : ${leadFormId}`);
    console.log(`📣 Campaign ID  : ${campaignId}`);
    console.log(`🎯 Ad Set ID    : ${adSetId}`);
    console.log('──────────────────────────────────────────');
    console.log('📁 IDs salvos em: campaign-ids.json');
    console.log('\n⚠️  PRÓXIMO PASSO:');
    console.log('   Rode: node add-creative.js');
    console.log('   (quando tiver a imagem ou vídeo do anúncio)\n');

  } catch (err) {
    log(`ERRO: ${err.message}`);
    console.error('\n❌ Erro:', err.message, '\n');
    process.exit(1);
  }
}

main();
