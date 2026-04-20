const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('📸 Gerando screenshot do criativo...');

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

  const htmlPath = path.join(__dirname, 'creatives', 'static-1080x1080.html');
  await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

  // Wait for fonts to load
  await new Promise(r => setTimeout(r, 2000));

  const outputPath = path.join(__dirname, 'creatives', 'criativo-1080x1080.png');
  await page.screenshot({ path: outputPath, clip: { x: 0, y: 0, width: 1080, height: 1080 } });

  await browser.close();

  console.log(`✅ Criativo salvo em: ${outputPath}`);
  return outputPath;
}

main().catch(e => { console.error('❌ Erro:', e.message); process.exit(1); });
