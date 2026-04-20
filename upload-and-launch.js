require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const {
  META_ACCESS_TOKEN,
  META_AD_ACCOUNT_ID,
  META_API_VERSION = 'v20.0',
  META_PAGE_ID,
  WHATSAPP_NUMBER,
} = process.env;

const BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const WA_TEXT = encodeURIComponent('Olá! Vi o anúncio e quero criar minha marca própria. Pode me ajudar?');
const WA_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${WA_TEXT}`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(__dirname, 'logs', 'wa-campaign.log'), line + '\n');
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
    throw new Error(detail ? `[${detail.code}] ${detail.error_user_msg || detail.message}` : err.message);
  }
}

async function uploadImageFile(filePath) {
  log('Fazendo upload da imagem PNG para Meta...');
  const form = new FormData();
  form.append('filename', fs.createReadStream(filePath));
  form.append('access_token', META_ACCESS_TOKEN);

  const res = await axios.post(`${BASE}/${META_AD_ACCOUNT_ID}/adimages`, form, {
    headers: form.getHeaders(),
  });

  const hash = Object.values(res.data.images)[0].hash;
  log(`✅ Imagem enviada. Hash: ${hash}`);
  return hash;
}

async function createCampaign() {
  log('Criando campanha...');
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/campaigns`, {
    name: 'Yahzzi Labs | Marca Própria | WhatsApp | 2026',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: '[]',
    is_adset_budget_sharing_enabled: false,
  });
  log(`✅ Campanha: ${result.id}`);
  return result.id;
}

async function createAdSet(campaignId) {
  log('Criando ad set...');
  const targeting = JSON.stringify({
    geo_locations: { countries: ['BR'] },
    age_min: 22, age_max: 55,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'story'],
    instagram_positions: ['stream', 'story'],
  });
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adsets`, {
    name: 'Yahzzi | Brasil | 22-55 | Menor Custo',
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    daily_budget: 3000,
    targeting,
    promoted_object: JSON.stringify({ page_id: META_PAGE_ID }),
    status: 'PAUSED',
  });
  log(`✅ Ad Set: ${result.id}`);
  return result.id;
}

async function createCreative(imageHash) {
  log('Criando criativo...');
  const copy = `Se você vende qualquer tipo de produto… ou quer entrar no mercado de suplementos e cosméticos…

Você pode estar deixando dinheiro na mesa vendendo marca dos outros.

Quem cresce de verdade tem marca própria. 🏆

Hoje você pode lançar sua própria linha de suplementos ou cosméticos…

🔥 E o melhor: dá pra começar com a partir de 100 unidades, dependendo da formulação.

Produto desenvolvido, fábrica pronta e estratégia pra vender.

👇 Clica e fala com a gente agora.`;

  const objectStorySpec = JSON.stringify({
    page_id: META_PAGE_ID,
    link_data: {
      message: copy,
      name: 'Pare de vender marca dos outros. Crie a sua.',
      description: 'Suplementos e cosméticos a partir de 100 unidades. Fórmula, embalagem e estratégia inclusos.',
      link: WA_LINK,
      image_hash: imageHash,
      call_to_action: {
        type: 'LEARN_MORE',
        value: { link: WA_LINK },
      },
    },
  });

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adcreatives`, {
    name: 'Criativo | Marca Própria | WhatsApp v1',
    object_story_spec: objectStorySpec,
  });
  log(`✅ Criativo: ${result.id}`);
  return result.id;
}

async function createAd(adSetId, creativeId) {
  log('Criando anúncio...');
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/ads`, {
    name: 'Anúncio | Marca Própria | WhatsApp v1',
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',
  });
  log(`✅ Anúncio: ${result.id}`);
  return result.id;
}

async function main() {
  console.log('\n🚀 YAHZZI LABS — UPLOAD + CAMPANHA COMPLETA\n');
  log('=== INÍCIO ===');

  const imagePath = path.join(__dirname, 'creatives', 'criativo-1080x1080.png');
  if (!fs.existsSync(imagePath)) {
    console.error('❌ Imagem não encontrada. Rode screenshot-creative.js primeiro.');
    process.exit(1);
  }

  try {
    const imageHash  = await uploadImageFile(imagePath);
    const campaignId = await createCampaign();
    const adSetId    = await createAdSet(campaignId);
    const creativeId = await createCreative(imageHash);
    const adId       = await createAd(adSetId, creativeId);

    const summary = { campaignId, adSetId, creativeId, adId, imageHash, waLink: WA_LINK, createdAt: new Date().toISOString(), status: 'PAUSED' };
    fs.writeFileSync(path.join(__dirname, 'campaign-ids.json'), JSON.stringify(summary, null, 2));

    console.log('\n✅ TUDO CRIADO E PRONTO!\n');
    console.log('──────────────────────────────────────');
    console.log(`📣 Campaign  : ${campaignId}`);
    console.log(`🎯 Ad Set    : ${adSetId}`);
    console.log(`🎨 Creative  : ${creativeId}`);
    console.log(`📢 Ad        : ${adId}`);
    console.log('──────────────────────────────────────');
    console.log('\n▶️  Para ativar: node activate-campaign.js\n');

  } catch (err) {
    log(`ERRO: ${err.message}`);
    console.error('\n❌ Erro:', err.message, '\n');
    process.exit(1);
  }
}

main();
