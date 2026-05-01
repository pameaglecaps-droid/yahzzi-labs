require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { execSync, spawn } = require('child_process');
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

// ─── META INSIGHTS (contexto para os prompts) ─────────────────────────────────

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
Responda APENAS com o prompt em inglês para o Stitch, sem explicações adicionais. Máximo 4 frases.`,
    messages: [{
      role: 'user',
      content: `Crie um prompt para o Google Stitch gerar: ${screenType}
Marca: ${config.brand.displayName}
Contexto: ${JSON.stringify(context)}`
    }]
  });

  return msg.content[0].text.trim();
}

// ─── STITCH MCP: executar comandos via CLI ────────────────────────────────────

function runStitchCli(args, opts = {}) {
  const cmd = `npx @_davideast/stitch-mcp ${args.join(' ')}`;
  log(`Executando: ${cmd}`);
  try {
    const output = execSync(cmd, {
      env: { ...process.env },
      timeout: 120000,
      encoding: 'utf8',
      ...opts
    });
    return output.trim();
  } catch (err) {
    throw new Error(`Stitch CLI erro: ${err.stderr || err.message}`);
  }
}

// Gera tela e retorna HTML via MCP build_site
function buildSiteFromProject(projectId, outputDir) {
  const screensDir = path.join(__dirname, 'public', outputDir || 'stitch-screens');
  if (!fs.existsSync(screensDir)) fs.mkdirSync(screensDir, { recursive: true });

  // Usa o comando `site` para exportar todas as telas do projeto
  log(`Exportando telas do projeto: ${projectId}`);
  runStitchCli(['site', '-p', projectId, '--output', screensDir]);
  return screensDir;
}

// ─── GERAR TELAS ESPECÍFICAS ──────────────────────────────────────────────────

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

  // Usa o MCP serve para gerar a tela interativamente
  const outputDir = path.join(__dirname, 'public', 'stitch-screens');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  log('Solicitando tela ao Stitch via MCP...');
  const result = runStitchCli(['serve', '-p', projectId, '--prompt', prompt, '--format', 'json']);

  let screenData = {};
  try {
    screenData = JSON.parse(result);
  } catch {
    screenData = { raw: result };
  }

  return { type: 'lead-page', prompt, projectId, screenData };
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

  log('Solicitando tela ao Stitch via MCP...');
  const result = runStitchCli(['serve', '-p', projectId, '--prompt', prompt, '--format', 'json']);

  let screenData = {};
  try {
    screenData = JSON.parse(result);
  } catch {
    screenData = { raw: result };
  }

  return { type: 'dashboard', prompt, projectId, screenData };
}

// Exporta TODAS as telas de um projeto Stitch para a pasta public/stitch-screens
async function exportProject(projectId) {
  log(`Exportando projeto completo: ${projectId}`);
  const outputDir = buildSiteFromProject(projectId);
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.html'));
  log(`${files.length} tela(s) exportada(s) para ${outputDir}`);
  return { type: 'export', projectId, outputDir, files };
}

// ─── SALVAR RESULTADOS ────────────────────────────────────────────────────────

function saveResults(results) {
  const logsDir = path.join(__dirname, 'logs');
  const file = path.join(logsDir, `stitch-results-${new Date().toISOString().split('T')[0]}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  existing.push({ timestamp: new Date().toISOString(), ...results });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  log(`Resultados salvos: ${file}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  const config = getConfig();
  const stitchConfig = config.google?.stitch;

  if (!stitchConfig?.enabled) {
    log('Google Stitch está desabilitado. Configure:');
    log('  1. Rode: npx @_davideast/stitch-mcp init');
    log('  2. Defina STITCH_PROJECT_ID no .env');
    log('  3. Ative: google.stitch.enabled: true no config.json');
    process.exit(0);
  }

  const projectId = process.env.STITCH_PROJECT_ID || stitchConfig.projectId;
  if (!projectId) {
    log('ERRO: STITCH_PROJECT_ID não configurado.');
    process.exit(1);
  }

  const mode = process.argv[2] || 'export';
  log(`=== STITCH AGENT INICIANDO — modo: ${mode} — projeto: ${projectId} ===`);

  let result;
  try {
    switch (mode) {
      case 'lead':
        result = await generateLeadPage(projectId);
        break;
      case 'dashboard':
        result = await generateDashboardScreen(projectId);
        break;
      case 'export':
      default:
        result = await exportProject(projectId);
        break;
    }

    saveResults({ mode, ...result });
    log('=== STITCH AGENT CONCLUÍDO ===');
    console.log('\nResultado:', JSON.stringify(result, null, 2));
  } catch (err) {
    log(`ERRO: ${err.message}`);
    process.exit(1);
  }
}

run();
