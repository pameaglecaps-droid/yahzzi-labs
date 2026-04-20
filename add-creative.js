require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── USO ─────────────────────────────────────────────────────────────────────
// Com imagem via URL:   node add-creative.js --image-url https://...
// Com imagem via hash:  node add-creative.js --image-hash abc123
// Com vídeo:            node add-creative.js --video-id 123456789
// ─────────────────────────────────────────────────────────────────────────────

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
    fs.appendFileSync(path.join(__dirname, 'logs', 'campaign-creation.log'), line + '\n');
  } catch {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--image-url')  result.imageUrl  = args[i + 1];
    if (args[i] === '--image-hash') result.imageHash = args[i + 1];
    if (args[i] === '--video-id')   result.videoId   = args[i + 1];
  }
  return result;
}

function loadCampaignIds() {
  const filePath = path.join(__dirname, 'campaign-ids.json');
  if (!fs.existsSync(filePath)) {
    throw new Error('campaign-ids.json não encontrado. Rode create-campaign.js primeiro.');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function metaPost(endpoint, data) {
  try {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE}/${endpoint}`;
    const res = await axios.post(url, null, {
      params: { ...data, access_token: META_ACCESS_TOKEN },
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data?.error;
    const msg = detail ? `[${detail.code}] ${detail.message}` : err.message;
    throw new Error(`Meta API (${endpoint}): ${msg}`);
  }
}

// Faz upload de imagem via URL e retorna o hash
async function uploadImageFromUrl(imageUrl) {
  log(`Fazendo upload da imagem: ${imageUrl}`);
  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adimages`, {
    filename: 'criativo_marca_propria.jpg',
    url: imageUrl,
  });
  const hash = Object.values(result.images)[0].hash;
  log(`✅ Imagem enviada. Hash: ${hash}`);
  return hash;
}

// Copia do anúncio baseada no roteiro do brief
const AD_COPY = `Se você vende qualquer tipo de produto… ou quer entrar no mercado de suplementos e cosméticos…

Você pode estar deixando dinheiro na mesa vendendo marca dos outros.

Quem cresce de verdade tem marca própria. 🏆

Hoje você pode lançar sua própria linha de suplementos ou cosméticos…

🔥 E o melhor: dá pra começar com a partir de 100 unidades, dependendo da formulação.

Com produto desenvolvido, fábrica pronta e estratégia pra vender.

👇 Clica aqui e cria sua marca.`;

const HEADLINE = 'Pare de depender de produtos de terceiros.';
const DESCRIPTION = 'Comece sua marca própria a partir de 100 unidades. Suplementos e cosméticos.';

// Criativo com imagem
async function createImageCreative(imageHash, leadFormId) {
  log('Criando criativo com imagem...');

  const objectStorySpec = JSON.stringify({
    page_id: META_PAGE_ID,
    link_data: {
      message: AD_COPY,
      name: HEADLINE,
      description: DESCRIPTION,
      image_hash: imageHash,
      call_to_action: {
        type: 'LEARN_MORE',
        value: { lead_gen_form_id: leadFormId },
      },
    },
  });

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adcreatives`, {
    name: 'Criativo | Marca Própria | Imagem v1',
    object_story_spec: objectStorySpec,
  });

  log(`✅ Criativo (imagem) criado: ${result.id}`);
  return result.id;
}

// Criativo com vídeo (Reel)
async function createVideoCreative(videoId, leadFormId) {
  log('Criando criativo com vídeo/reel...');

  const objectStorySpec = JSON.stringify({
    page_id: META_PAGE_ID,
    video_data: {
      video_id: videoId,
      message: AD_COPY,
      title: HEADLINE,
      call_to_action: {
        type: 'LEARN_MORE',
        value: { lead_gen_form_id: leadFormId },
      },
    },
  });

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/adcreatives`, {
    name: 'Criativo | Marca Própria | Reel v1',
    object_story_spec: objectStorySpec,
  });

  log(`✅ Criativo (vídeo) criado: ${result.id}`);
  return result.id;
}

// Cria o anúncio final
async function createAd(adSetId, creativeId) {
  log('Criando anúncio...');

  const result = await metaPost(`${META_AD_ACCOUNT_ID}/ads`, {
    name: 'Anúncio | Marca Própria v1',
    adset_id: adSetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',
  });

  log(`✅ Anúncio criado: ${result.id}`);
  return result.id;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🎨 YAHZZI LABS — ADICIONANDO CRIATIVO\n');

  const args = parseArgs();

  if (!args.imageUrl && !args.imageHash && !args.videoId) {
    console.log('USO:');
    console.log('  Com imagem via URL:   node add-creative.js --image-url https://...');
    console.log('  Com imagem via hash:  node add-creative.js --image-hash abc123');
    console.log('  Com vídeo/reel:       node add-creative.js --video-id 123456789\n');
    process.exit(0);
  }

  try {
    const ids = loadCampaignIds();
    log(`IDs carregados: ${JSON.stringify(ids)}`);

    let creativeId;

    if (args.videoId) {
      creativeId = await createVideoCreative(args.videoId, ids.leadFormId);
    } else {
      let imageHash = args.imageHash;
      if (args.imageUrl) {
        imageHash = await uploadImageFromUrl(args.imageUrl);
      }
      creativeId = await createImageCreative(imageHash, ids.leadFormId);
    }

    const adId = await createAd(ids.adSetId, creativeId);

    // Atualiza campaign-ids.json
    const updated = { ...ids, creativeId, adId, status: 'PAUSED — pronto para ativar' };
    fs.writeFileSync(path.join(__dirname, 'campaign-ids.json'), JSON.stringify(updated, null, 2));

    console.log('\n✅ CRIATIVO E ANÚNCIO PRONTOS!\n');
    console.log('──────────────────────────────────────────');
    console.log(`🎨 Creative ID : ${creativeId}`);
    console.log(`📢 Ad ID       : ${adId}`);
    console.log('──────────────────────────────────────────');
    console.log('\n⚠️  PRÓXIMO PASSO: Ativar no Gerenciador de Anúncios do Meta');
    console.log('   OU rode: node activate-campaign.js\n');

  } catch (err) {
    log(`ERRO: ${err.message}`);
    console.error('\n❌ Erro:', err.message, '\n');
    process.exit(1);
  }
}

main();
