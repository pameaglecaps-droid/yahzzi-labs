require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { META_ACCESS_TOKEN, META_API_VERSION = 'v20.0' } = process.env;
const BASE = `https://graph.facebook.com/${META_API_VERSION}`;

async function setStatus(id, status) {
  const res = await axios.post(`${BASE}/${id}`, null, {
    params: { status, access_token: META_ACCESS_TOKEN },
  });
  return res.data;
}

async function main() {
  console.log('\n⚡ YAHZZI LABS — ATIVANDO CAMPANHA\n');

  const filePath = path.join(__dirname, 'campaign-ids.json');
  if (!fs.existsSync(filePath)) {
    console.error('❌ campaign-ids.json não encontrado. Rode create-campaign.js primeiro.');
    process.exit(1);
  }

  const ids = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!ids.adId) {
    console.error('❌ Ad não encontrado. Rode add-creative.js primeiro para criar o anúncio.');
    process.exit(1);
  }

  try {
    console.log('Ativando campanha...');
    await setStatus(ids.campaignId, 'ACTIVE');
    console.log(`✅ Campanha ativa: ${ids.campaignId}`);

    console.log('Ativando ad set...');
    await setStatus(ids.adSetId, 'ACTIVE');
    console.log(`✅ Ad Set ativo: ${ids.adSetId}`);

    console.log('Ativando anúncio...');
    await setStatus(ids.adId, 'ACTIVE');
    console.log(`✅ Anúncio ativo: ${ids.adId}`);

    const updated = { ...ids, status: 'ACTIVE', activatedAt: new Date().toISOString() };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));

    console.log('\n🚀 CAMPANHA NO AR!\n');
    console.log('──────────────────────────────────────────');
    console.log(`📣 Campaign : ${ids.campaignId}`);
    console.log(`🎯 Ad Set   : ${ids.adSetId}`);
    console.log(`📢 Ad       : ${ids.adId}`);
    console.log('──────────────────────────────────────────');
    console.log('Acesse o Gerenciador de Anúncios para acompanhar os resultados.\n');

  } catch (err) {
    const detail = err.response?.data?.error;
    console.error('\n❌ Erro:', detail?.message || err.message, '\n');
    process.exit(1);
  }
}

main();
