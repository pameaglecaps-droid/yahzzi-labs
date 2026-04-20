require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const {
  META_ACCESS_TOKEN,
  META_AD_ACCOUNT_ID,
  META_API_VERSION = 'v20.0',
  META_PAGE_ID,
} = process.env;

const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(path.join(__dirname, 'logs'))) fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
    fs.appendFileSync(path.join(__dirname, 'logs', 'campaign-creation.log'), line + '\n');
  } catch {}
}

async function metaPost(endpoint, data) {
  try {
    const res = await axios.post(`${BASE}/${endpoint}`, null, {
      params: { ...data, access_token: META_ACCESS_TOKEN },
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.error;
    throw new Error(detail ? `[${detail.code}] ${detail.message}` : err.message);
  }
}

async function createCampaign() {
  log('Criando campanha...');
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/campaigns`, {
    name: 'Yahzzi Labs | Marca Própria | Lead Gen | 2026',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: '[]',
    is_adset_budget_sharing_enabled: false,
  });
  log(`✅ Campanha criada: ${result.id}`);
  return result.id;
}

async function createAdSet(campaignId) {
  log('Criando conjunto de anúncios...');
  const targeting = JSON.stringify({
    geo_locations: { countries: ['BR'] },
    age_min: 22,
    age_max: 55,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'facebook_reels', 'story'],
    instagram_positions: ['stream', 'reels', 'story'],
  });

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adsets`, {
    name: 'Yahzzi | Brasil Amplo | 22-55 | Menor Custo',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: 3000,
    targeting,
    promoted_object: JSON.stringify({ page_id: META_PAGE_ID }),
    destination_type: 'ON_AD',
    status: 'PAUSED',
  });
  log(`✅ Ad Set criado: ${result.id}`);
  return result.id;
}

async function main() {
  console.log('\n🚀 YAHZZI LABS — CRIANDO CAMPANHA + AD SET\n');
  log('=== INÍCIO ===');

  try {
    const campaignId = await createCampaign();
    const adSetId = await createAdSet(campaignId);

    const summary = {
      campaignId,
      adSetId,
      leadFormId: null,
      createdAt: new Date().toISOString(),
      status: 'PAUSED — aguardando lead form ID',
    };

    fs.writeFileSync(path.join(__dirname, 'campaign-ids.json'), JSON.stringify(summary, null, 2));

    console.log('\n✅ CAMPANHA E AD SET CRIADOS!\n');
    console.log('──────────────────────────────────────────');
    console.log(`📣 Campaign ID : ${campaignId}`);
    console.log(`🎯 Ad Set ID   : ${adSetId}`);
    console.log('──────────────────────────────────────────');
    console.log('\n⚠️  PRÓXIMO PASSO: criar o formulário no Meta e rodar:');
    console.log('   node add-form-and-creative.js --form-id SEU_FORM_ID --image-url SUA_IMAGEM\n');

  } catch (err) {
    log(`ERRO: ${err.message}`);
    console.error('\n❌ Erro:', err.message, '\n');
    process.exit(1);
  }
}

main();
