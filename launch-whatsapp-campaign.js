require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
    if (!fs.existsSync(path.join(__dirname, 'logs'))) fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
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

// STEP 1: Campanha MESSAGES → WhatsApp
async function createCampaign() {
  log('Criando campanha click-to-WhatsApp...');
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

// STEP 2: AdSet
async function createAdSet(campaignId) {
  log('Criando ad set...');
  const targeting = JSON.stringify({
    geo_locations: { countries: ['BR'] },
    age_min: 22,
    age_max: 55,
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

// STEP 3: Upload imagem
async function uploadImage(imageUrl) {
  log(`Fazendo upload da imagem...`);
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adimages`, {
    filename: 'criativo_yahzzi.jpg',
    url: imageUrl,
  });
  const hash = Object.values(result.images)[0].hash;
  log(`✅ Imagem: hash ${hash}`);
  return hash;
}

// STEP 4: Criativo
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

// STEP 5: Anúncio
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

// MAIN
async function main() {
  console.log('\n🚀 YAHZZI LABS — CAMPANHA CLICK-TO-WHATSAPP\n');

  // Imagem passada como argumento: node launch-whatsapp-campaign.js https://url-da-imagem.jpg
  const imageUrl = process.argv[2];
  if (!imageUrl) {
    console.log('USO: node launch-whatsapp-campaign.js https://url-da-sua-imagem.jpg\n');
    console.log('Dica: abra o criativo static-1080x1080.html no Chrome,');
    console.log('      tire screenshot e hospede no imgur.com ou use qualquer URL pública de imagem.\n');
    process.exit(0);
  }

  try {
    const campaignId = await createCampaign();
    const adSetId    = await createAdSet(campaignId);
    const imageHash  = await uploadImage(imageUrl);
    const creativeId = await createCreative(imageHash);
    const adId       = await createAd(adSetId, creativeId);

    const summary = {
      campaignId, adSetId, creativeId, adId,
      imageHash,
      waLink: WA_LINK,
      createdAt: new Date().toISOString(),
      status: 'PAUSED — pronto para ativar',
    };

    fs.writeFileSync(path.join(__dirname, 'campaign-ids.json'), JSON.stringify(summary, null, 2));

    console.log('\n✅ CAMPANHA COMPLETA E PRONTA!\n');
    console.log('──────────────────────────────────────────');
    console.log(`📣 Campaign  : ${campaignId}`);
    console.log(`🎯 Ad Set    : ${adSetId}`);
    console.log(`🎨 Creative  : ${creativeId}`);
    console.log(`📢 Ad        : ${adId}`);
    console.log('──────────────────────────────────────────');
    console.log('\n▶️  Para ativar: node activate-campaign.js\n');

  } catch (err) {
    log(`ERRO: ${err.message}`);
    console.error('\n❌ Erro:', err.message, '\n');
    process.exit(1);
  }
}

main();
