require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(path.join(logsDir, 'stitch-agent.log'), line + '\n');
}

function getConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}

// ─── META INSIGHTS ────────────────────────────────────────────────────────────

async function getMetaInsights() {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_API_VERSION = 'v20.0' } = process.env;
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) return null;
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/${META_AD_ACCOUNT_ID}/insights`,
      {
        params: {
          access_token: META_ACCESS_TOKEN,
          fields: 'spend,impressions,clicks,actions,ctr,cpc',
          date_preset: 'last_7d',
          level: 'account'
        }
      }
    );
    return data.data?.[0] || null;
  } catch {
    return null;
  }
}

// ─── CLAUDE: gerar prompt para o Stitch ──────────────────────────────────────

async function buildStitchPrompt(screenType, context = {}) {
  const config = getConfig();
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `Você é um designer de UI especializado em landing pages de alta conversão para marketing digital.
Crie prompts detalhados para o Google Stitch gerar telas bonitas e funcionais.
Responda APENAS com o prompt em inglês para o Stitch, sem explicações. Máximo 4 frases.`,
    messages: [{
      role: 'user',
      content: `Crie um prompt para o Google Stitch gerar: ${screenType}
Marca: ${config.brand.displayName}
Contexto: ${JSON.stringify(context)}`
    }]
  });
  return msg.content[0].text.trim();
}

// ─── STITCH MCP CLI ───────────────────────────────────────────────────────────

function stitch(args, extraEnv = {}) {
  const cmd = `npx @_davideast/stitch-mcp ${args.join(' ')}`;
  log(`Stitch: ${cmd}`);
  return execSync(cmd, {
    env: { ...process.env, ...extraEnv },
    timeout: 120000,
    encoding: 'utf8'
  }).trim();
}

// Chama uma MCP tool diretamente via CLI
function stitchTool(toolName, data, extraEnv = {}) {
  const tmpFile = `/tmp/stitch-data-${Date.now()}.json`;
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  const cmd = `npx @_davideast/stitch-mcp tool ${toolName} -f '${tmpFile}' -o json`;
  log(`Stitch tool: ${toolName}`);
  try {
    const out = execSync(cmd, {
      env: { ...process.env, ...extraEnv },
      timeout: 180000,
      encoding: 'utf8'
    }).trim();
    fs.unlinkSync(tmpFile);
    return JSON.parse(out);
  } catch (err) {
    fs.existsSync(tmpFile) && fs.unlinkSync(tmpFile);
    throw err;
  }
}

// Extrai HTML e screenshot a partir do resultado de generate_screen_from_text
function extractScreenData(result) {
  const screens = result?.outputComponents?.[1]?.design?.screens;
  if (!screens || !screens[0]) return null;
  const s = screens[0];
  return {
    screenName: s.name,
    htmlDownloadUrl: s.htmlCode?.downloadUrl,
    screenshotUrl: s.screenshot?.downloadUrl,
    designSystem: s.designSystem?.designSystem,
    theme: s.theme?.designMd
  };
}

// ─── SCREENS ──────────────────────────────────────────────────────────────────

async function generateLeadPage(projectId) {
  const config = getConfig();
  const insights = await getMetaInsights();
  const context = {
    brand: config.brand.displayName,
    whatsapp: config.whatsapp.number,
    leadFields: config.leadForm.fields,
    spend: insights?.spend || 'N/A',
    ctr: insights?.ctr || 'N/A'
  };

  log('Gerando prompt de lead page com Claude...');
  const prompt = await buildStitchPrompt('Lead capture landing page for WhatsApp conversion', context);
  log(`Prompt: ${prompt}`);

  log('Chamando Stitch MCP tool: snapshot...');
  const result = stitchTool('snapshot', { projectId, prompt, deviceType: 'mobile' });

  const outputDir = path.join(__dirname, 'public', 'stitch-screens');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (result.html) {
    const slug = `lead-page-${Date.now()}.html`;
    fs.writeFileSync(path.join(outputDir, slug), result.html);
    log(`Lead page salva: public/stitch-screens/${slug}`);
    return { type: 'lead-page', prompt, slug, localPath: `/stitch-screens/${slug}`, imageUrl: result.imageUrl };
  }

  return { type: 'lead-page', prompt, result };
}

async function generateDashboardScreen(projectId) {
  const config = getConfig();
  const insights = await getMetaInsights();
  const context = {
    brand: config.brand.displayName,
    metrics: {
      spend: insights?.spend || '0',
      impressions: insights?.impressions || '0',
      clicks: insights?.clicks || '0',
      ctr: insights?.ctr || '0'
    },
    platforms: ['Meta Ads', 'TikTok Ads']
  };

  log('Gerando prompt de dashboard com Claude...');
  const prompt = await buildStitchPrompt('Ad performance dashboard with metrics cards and charts', context);
  log(`Prompt: ${prompt}`);

  log('Chamando Stitch MCP tool: snapshot...');
  const result = stitchTool('snapshot', { projectId, prompt, deviceType: 'desktop' });

  const outputDir = path.join(__dirname, 'public', 'stitch-screens');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (result.html) {
    const slug = `dashboard-${Date.now()}.html`;
    fs.writeFileSync(path.join(outputDir, slug), result.html);
    log(`Dashboard salvo: public/stitch-screens/${slug}`);
    return { type: 'dashboard', prompt, slug, localPath: `/stitch-screens/${slug}`, imageUrl: result.imageUrl };
  }

  return { type: 'dashboard', prompt, result };
}

// Exporta todas as telas do projeto para public/stitch-screens
async function exportProject(projectId) {
  log(`Exportando projeto: ${projectId}`);
  const outputDir = path.join(__dirname, 'public', 'stitch-screens');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  stitch(['site', '-p', projectId, '--output', outputDir]);

  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.html'));
  log(`${files.length} tela(s) exportada(s)`);
  return { type: 'export', projectId, outputDir, files };
}

// Lista screens disponíveis no projeto
async function listScreens(projectId) {
  log(`Listando screens do projeto: ${projectId}`);
  const output = stitch(['screens', '-p', projectId, '--json']);
  const screens = JSON.parse(output);
  return { type: 'list', projectId, screens };
}

// ─── SALVAR RESULTADOS ────────────────────────────────────────────────────────

function saveResults(results) {
  const file = path.join(__dirname, 'logs', `stitch-results-${new Date().toISOString().split('T')[0]}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  existing.push({ timestamp: new Date().toISOString(), ...results });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  log(`Resultados salvos: ${file}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  const config = getConfig();
  const stitchConfig = config.google?.stitch;

  if (!process.env.STITCH_API_KEY) {
    log('AVISO: STITCH_API_KEY não encontrada no .env');
    log('Obtenha sua API key em: https://stitch.withgoogle.com → Settings → API Keys');
    log('Adicione ao .env: STITCH_API_KEY=sua-chave-aqui');
  }

  if (!stitchConfig?.enabled) {
    log('Google Stitch desabilitado em config.json. Para ativar:');
    log('  1. Adicione STITCH_API_KEY e STITCH_PROJECT_ID ao .env');
    log('  2. Ative: "google": { "stitch": { "enabled": true, "projectId": "..." } }');
    process.exit(0);
  }

  const projectId = process.env.STITCH_PROJECT_ID || stitchConfig.projectId;
  if (!projectId) {
    log('ERRO: STITCH_PROJECT_ID não configurado. Adicione ao .env ou config.json.');
    process.exit(1);
  }

  const mode = process.argv[2] || 'export';
  log(`=== STITCH AGENT — modo: ${mode} — projeto: ${projectId} ===`);

  let result;
  try {
    switch (mode) {
      case 'lead':      result = await generateLeadPage(projectId); break;
      case 'dashboard': result = await generateDashboardScreen(projectId); break;
      case 'list':      result = await listScreens(projectId); break;
      case 'export':
      default:          result = await exportProject(projectId); break;
    }

    saveResults({ mode, ...result });
    log('=== CONCLUÍDO ===');
    console.log('\nResultado:', JSON.stringify(result, null, 2));
  } catch (err) {
    log(`ERRO: ${err.message}`);
    process.exit(1);
  }
}

run();
