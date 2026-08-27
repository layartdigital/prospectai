#!/usr/bin/env node
/**
 * GATE 0 — Descoberta de sinais sociais a partir de um lead do Google Maps.
 *
 * Mede se a v0.2 e viavel: dado um lead do scraper, com que taxa
 * consigo DESCOBRIR e VERIFICAR Instagram e Facebook — e com que taxa
 * de erro silencioso.
 *
 * Node puro. Zero dependencias. Requer Node 18+.
 *
 * TRES CAMADAS, em ordem de forca:
 *
 *   A. SCRAPER — o "site" do lead ja e a rede social.
 *                Ex: website = instagram.com/clinicaxyz
 *                Custo zero, confianca maxima.
 *
 *   B. SITE    — o site proprio do lead linka para as redes.
 *                <a href="instagram.com/..."> no HTML. Deterministico.
 *
 *   C. HANDLE  — heuristica sobre o nome + verificacao.
 *                So vira PRESENTE com CORROBORACAO (telefone na pagina).
 *                Sem corroboracao: fica DESCONHECIDO.
 *
 * REGRA FUNDADORA (do scoring.md deste projeto):
 *     "O score so pontua o que foi efetivamente observado."
 *     Nada aqui vira AUSENTE. Nunca. Nao encontrar um perfil nao prova
 *     que ele nao existe. A saida so tem PRESENTE ou DESCONHECIDO.
 *
 * O QUE ESTE SCRIPT MEDE DE VERDADE:
 *     Nao e so a taxa de acerto — e se a via TECNICA existe.
 *     Instagram e Facebook bloqueiam acesso nao autenticado. Se a camada C
 *     retornar BLOQUEADO em massa, o resultado nao e "descoberta baixa",
 *     e "esta via nao existe", e a decisao vira API oficial/fornecedor.
 *     Por isso BLOQUEADO e NAO_ENCONTRADO sao contados separadamente.
 *
 * Uso:
 *     node gate0/measure-social.mjs data/gmapsdata/arquivo.csv
 *     node gate0/measure-social.mjs arquivo.csv --skip-handle
 *     node gate0/measure-social.mjs arquivo.csv --limit 30 --out saida.csv
 */

import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

const SITE_TIMEOUT = 12_000;
const SOCIAL_TIMEOUT = 12_000;
const DELAY_SITE = 1_000;
const DELAY_SOCIAL = 3_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Dominios que o scoring.md classifica como SITE_PRECARIO
const PRECARIO = [
  "base44.app", "wixsite.com", "negocio.site", "blogspot.com",
  "wordpress.com", "linktr.ee", "instagram.com", "facebook.com",
  "linkbio.co", "beacons.ai", "bio.link",
];

const INSTAGRAM_IGNORE = new Set([
  "explore", "accounts", "p", "reel", "reels", "stories", "direct",
  "about", "developer", "legal", "privacy", "instagram", "tv", "help",
]);

const FACEBOOK_IGNORE = new Set([
  "sharer", "share", "dialog", "plugins", "tr", "pages", "profile.php",
  "groups", "events", "watch", "marketplace", "help", "policies",
  "facebook", "login", "sharer.php",
]);

const STOPWORDS = new Set([
  "dr", "dra", "clinica", "consultorio", "centro", "instituto", "espaco",
  "studio", "ltda", "me", "epp", "eireli", "sa", "e", "de", "da", "do",
  "das", "dos", "em", "the",
]);

// ---------------------------------------------------------------------------
// Parser de CSV (RFC 4180) — o CSV do scraper tem JSON embutido nos campos
// ---------------------------------------------------------------------------

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c === "\r") {
      // ignora; o \n seguinte fecha a linha
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function toCSV(objs) {
  if (!objs.length) return "";
  const cols = Object.keys(objs[0]);
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...objs.map((o) => cols.map((c) => esc(o[c])).join(","))]
    .join("\n");
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(text) {
  return (text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza telefone brasileiro. So gera formas SEMANTICAMENTE VALIDAS —
 * fatiar arbitrariamente ("os ultimos 10 digitos") produz sequencias que
 * nao sao telefone nenhum e podem casar por acaso numa pagina, inflando
 * a corroboracao com falso positivo.
 */
function phoneDigits(phone) {
  let d = (phone || "").replace(/\D/g, "");
  if (!d) return [];
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);

  const formas = new Set();
  if (d.length === 10 || d.length === 11) {
    formas.add(d);
    formas.add(d.slice(2));
  } else if (d.length === 8 || d.length === 9) {
    formas.add(d);
  }
  return [...formas].sort((a, b) => b.length - a.length);
}

function cityFromRow(row) {
  try {
    return JSON.parse(row.complete_address || "{}")?.city ?? "";
  } catch { return ""; }
}

function classifyWebsite(website) {
  const w = (website || "").trim();
  if (!w) return "SEM_SITE";
  const low = w.toLowerCase();
  return PRECARIO.some((p) => low.includes(p)) ? "SITE_PRECARIO" : "SITE_PROPRIO";
}

// ---------------------------------------------------------------------------
// Extracao de perfis
// ---------------------------------------------------------------------------

const RE_INSTAGRAM = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{1,30})/gi;
const RE_FACEBOOK = /(?:https?:\/\/)?(?:www\.|m\.|pt-br\.)?facebook\.com\/([A-Za-z0-9_.-]{1,60})/gi;

const MIN_HANDLE = 4;   // "facebook.com/cl" e lixo de parsing, nao perfil

function extractProfiles(html) {
  let insta = null, fb = null;

  for (const m of html.matchAll(RE_INSTAGRAM)) {
    const h = m[1].replace(/\.+$/, "").toLowerCase();
    if (h.length >= MIN_HANDLE && !INSTAGRAM_IGNORE.has(h) && !h.endsWith(".php")) {
      insta = h; break;
    }
  }
  for (const m of html.matchAll(RE_FACEBOOK)) {
    const h = m[1].replace(/\.+$/, "").toLowerCase();
    if (h.length >= MIN_HANDLE && !FACEBOOK_IGNORE.has(h) && !h.endsWith(".php")) {
      fb = h; break;
    }
  }
  return { insta, fb };
}

/** Retorna { status: 'ok'|'bloqueado'|'sem_resposta', html } */
async function fetchPage(url, timeout) {
  const candidates = url.startsWith("http")
    ? [url]
    : [`https://${url}`, `http://${url}`];

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if ([401, 403, 429].includes(res.status)) return { status: "bloqueado", html: "" };
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 600_000);
      return { status: "ok", html };
    } catch { /* tenta o proximo */ }
  }
  return { status: "sem_resposta", html: "" };
}

// ---------------------------------------------------------------------------
// Camada C — heuristica de handle
// ---------------------------------------------------------------------------

/**
 * Deriva handles do MAIS provavel para o menos.
 * A categoria e removida: "Dra. Cintia Guedes - Dermatologista" quase nunca
 * vira @cintiaguedesdermatologista. Ordem errada faz o script parar no
 * primeiro perfil que responde, que pode ser o menos provavel.
 */
function handleCandidates(title, category = "") {
  const palavras = normalize(title).split(" ").filter(Boolean);
  const prefixo = palavras.includes("dra") ? "dra"
    : palavras.includes("dr") ? "dr" : "";

  const catTokens = new Set(
    normalize(category).split(" ").filter((t) => t && !STOPWORDS.has(t))
  );
  const base = palavras.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  let tokens = base.filter((t) => !catTokens.has(t));

  // Fallback: em "Pet Shop do Ze" na categoria "Pet shop" a categoria
  // consome o nome inteiro. Melhor tentar com o nome completo.
  if (!tokens.length || tokens.slice(0, 2).join("").length < 3) tokens = base;
  if (!tokens.length) return [];

  const curto = tokens.slice(0, 2).join("");
  const todo = tokens.join("");

  const ordenados = [];
  if (prefixo) ordenados.push(prefixo + curto);
  ordenados.push(curto);
  if (todo !== curto) {
    if (prefixo) ordenados.push(prefixo + todo);
    ordenados.push(todo);
  }

  const vistos = new Set();
  return ordenados
    .filter((c) => c.length >= 3 && c.length <= 30 && !vistos.has(c) && vistos.add(c))
    .slice(0, 4);
}

async function verifyProfile(url, phones, title) {
  const { status, html } = await fetchPage(url, SOCIAL_TIMEOUT);
  if (status !== "ok") return { status, corroborado: false, motivo: status };

  const pageDigits = html.replace(/\D/g, "");

  // Corroboracao forte: telefone do lead na pagina
  for (const p of phones) {
    if (p.length >= 10 && pageDigits.includes(p)) {
      return { status: "ok", corroborado: true, motivo: `telefone ${p}` };
    }
  }

  // Corroboracao fraca: nome do negocio na pagina
  const tokens = normalize(title).split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (tokens.length) {
    const normHtml = normalize(html.slice(0, 20_000));
    const hits = tokens.filter((t) => normHtml.includes(t)).length;
    if (hits >= Math.max(2, Math.floor(tokens.length / 2))) {
      return { status: "ok", corroborado: false,
               motivo: `nome (${hits}/${tokens.length} tokens) — FRACO` };
    }
  }

  return { status: "ok", corroborado: false, motivo: "sem corroboracao" };
}

// ---------------------------------------------------------------------------
// Processa um lead
// ---------------------------------------------------------------------------

async function processLead(row, skipHandle) {
  const title = (row.title || "").trim();
  const website = (row.website || "").trim();
  const phone = (row.phone || "").trim();
  const phones = phoneDigits(phone);
  const faixa = classifyWebsite(website);

  const out = {
    title,
    category: (row.category || "").trim(),
    city: cityFromRow(row),
    faixa_site: faixa,
    website,
    phone,
    camada: "",
    instagram: "",
    facebook: "",
    corroboracao: "",
    hasInstagram: "DESCONHECIDO",
    hasFacebook: "DESCONHECIDO",
    status_tecnico: "",
    verificacao_humana: "",   // preencher a mao: OK | ERRADO | NAO_SEI
    observacao: "",
  };

  // ---- Camada A: o proprio website ja e a rede social ----
  if (faixa === "SITE_PRECARIO") {
    const { insta, fb } = extractProfiles(website);
    if (insta || fb) {
      Object.assign(out, {
        camada: "A_SCRAPER",
        instagram: insta ? `instagram.com/${insta}` : "",
        facebook: fb ? `facebook.com/${fb}` : "",
        hasInstagram: insta ? "PRESENTE" : "DESCONHECIDO",
        hasFacebook: fb ? "PRESENTE" : "DESCONHECIDO",
        corroboracao: "veio do scraper",
        status_tecnico: "ok",
      });
      return out;
    }
  }

  // ---- Camada B: extrair do site proprio ----
  if (website) {
    const { status, html } = await fetchPage(website, SITE_TIMEOUT);
    out.status_tecnico = status;
    if (status === "ok") {
      const { insta, fb } = extractProfiles(html);
      if (insta || fb) {
        Object.assign(out, {
          camada: "B_SITE",
          instagram: insta ? `instagram.com/${insta}` : "",
          facebook: fb ? `facebook.com/${fb}` : "",
          hasInstagram: insta ? "PRESENTE" : "DESCONHECIDO",
          hasFacebook: fb ? "PRESENTE" : "DESCONHECIDO",
          corroboracao: "link no site do lead",
        });
        return out;
      }
      out.observacao = "site respondeu, sem link para redes";
    }
    await sleep(DELAY_SITE);
  }

  // ---- Camada C: heuristica de handle ----
  if (skipHandle) { out.camada = "C_PULADA"; return out; }

  for (const cand of handleCandidates(title, out.category)) {
    const url = `https://www.instagram.com/${cand}/`;
    const { status, corroborado, motivo } = await verifyProfile(url, phones, title);
    await sleep(DELAY_SOCIAL);

    if (status === "bloqueado") {
      Object.assign(out, {
        camada: "C_HANDLE",
        status_tecnico: "bloqueado",
        observacao: "Instagram bloqueou acesso nao autenticado",
      });
      return out;
    }

    if (status === "ok") {
      out.instagram = `instagram.com/${cand}`;
      out.camada = "C_HANDLE";
      out.corroboracao = motivo;
      out.status_tecnico = "ok";
      if (corroborado) {
        out.hasInstagram = "PRESENTE";
      } else {
        out.hasInstagram = "DESCONHECIDO";
        out.observacao = "candidato SEM corroboracao — nao promover";
      }
      return out;
    }
  }

  out.camada = "C_HANDLE";
  out.status_tecnico = out.status_tecnico || "nao_encontrado";
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) {
    console.error("Uso: node gate0/measure-social.mjs <csv> [--skip-handle] [--limit N] [--out arquivo.csv]");
    process.exit(1);
  }
  const skipHandle = args.includes("--skip-handle");
  const onlySemSite = args.includes("--only-sem-site");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const outIdx = args.indexOf("--out");
  const outFile = outIdx >= 0 ? args[outIdx + 1] : "gate0_social.csv";

  const rows = parseCSV(readFileSync(input, "utf8"));
  if (!rows.length) { console.error("CSV vazio."); process.exit(1); }

  // Estratificacao: garante presenca dos SEM_SITE, que sao o teste real
  const semSite = rows.filter((r) => classifyWebsite(r.website) === "SEM_SITE");
  const outros = rows.filter((r) => classifyWebsite(r.website) !== "SEM_SITE");

  let amostra;
  if (onlySemSite) {
    amostra = limit ? semSite.slice(0, limit) : semSite;
  } else if (limit) {
    const nSem = Math.min(semSite.length, Math.max(1, Math.floor((limit * 2) / 3)));
    amostra = [...semSite.slice(0, nSem), ...outros.slice(0, limit - nSem)];
  } else {
    amostra = [...semSite, ...outros];
  }

  console.log(`Total no CSV: ${rows.length}`);
  console.log(`Amostra: ${amostra.length}  (SEM_SITE: ${
    amostra.filter((r) => classifyWebsite(r.website) === "SEM_SITE").length})`);
  if (!skipHandle) console.log("Camada C ativa — vai tocar no Instagram. Use --skip-handle para pular.");
  console.log("");

  const results = [];
  for (const [i, row] of amostra.entries()) {
    const r = await processLead(row, skipHandle);
    results.push(r);
    const marca = (r.hasInstagram === "PRESENTE" || r.hasFacebook === "PRESENTE") ? "OK " : "   ";
    console.log(`[${i + 1}/${amostra.length}] ${marca} ${r.faixa_site.padEnd(14)} ` +
                `${r.camada.padEnd(10)} ${r.title.slice(0, 42)}`);
  }

  writeFileSync(outFile, "﻿" + toCSV(results), "utf8");

  // ---- Sumario ----
  const total = results.length;
  const count = (arr, fn) => arr.filter(fn).length;
  const presentes = count(results, (r) => r.hasInstagram === "PRESENTE" || r.hasFacebook === "PRESENTE");
  const candidatos = count(results, (r) => r.camada === "C_HANDLE" && r.instagram && r.hasInstagram !== "PRESENTE");
  const bloqueados = count(results, (r) => r.status_tecnico === "bloqueado");

  const tally = (fn) => results.reduce((m, r) => m.set(fn(r), (m.get(fn(r)) ?? 0) + 1), new Map());

  console.log("\n" + "=".repeat(62));
  console.log("RESULTADO — GATE 0 (sinais sociais)");
  console.log("=".repeat(62));
  console.log(`Total processado ............... ${total}`);
  for (const [k, n] of [...tally((r) => r.faixa_site)].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(16)} ${String(n).padStart(4)}`);
  console.log("\nPor camada de descoberta:");
  for (const [k, n] of [...tally((r) => r.camada)].sort((a, b) => b[1] - a[1]))
    console.log(`  ${(k || "—").padEnd(16)} ${String(n).padStart(4)}`);
  console.log("");
  console.log(`PRESENTE (corroborado) ......... ${String(presentes).padStart(4)}  (${(presentes / total * 100).toFixed(0)}%)`);
  console.log(`Candidato sem corroboracao ..... ${String(candidatos).padStart(4)}  (fica DESCONHECIDO)`);
  console.log(`Bloqueado pela plataforma ...... ${String(bloqueados).padStart(4)}`);

  const ss = results.filter((r) => r.faixa_site === "SEM_SITE");
  if (ss.length) {
    console.log(`\n** SEM_SITE — o que decide **`);
    if (skipHandle) {
      // A camada C e a UNICA que pode resolver SEM_SITE. Com --skip-handle
      // ela nem roda, entao "0 de N" nao e medicao, e ausencia de teste.
      // Reportar isso como reprovacao seria mentir sobre o resultado.
      console.log(`   NAO MEDIDO — a camada C foi pulada (--skip-handle).`);
      console.log(`   Estes ${ss.length} leads so podem ser resolvidos pela camada C.`);
      console.log(`   Rode sem --skip-handle para obter o numero que decide.`);
    } else {
      const ok = count(ss, (r) => r.hasInstagram === "PRESENTE" || r.hasFacebook === "PRESENTE");
      const pct = (ok / ss.length) * 100;
      console.log(`   ${ok}/${ss.length} resolvidos (${pct.toFixed(0)}%)   limiar: >= 40%`);
      console.log(`   ${pct >= 40 ? "PASSA" : "NAO PASSA"}`);
    }
  }
  console.log("=".repeat(62));

  if (bloqueados > total * 0.3) {
    console.log("\n!! ATENCAO: mais de 30% bloqueado pela plataforma.");
    console.log("   O resultado NAO e 'descoberta baixa' — e 'esta via nao existe'.");
    console.log("   A decisao vira: API oficial, fornecedor pago, ou nao fazer.");
  }

  console.log(`\nCSV: ${outFile}`);
  console.log("\nFALTA O NUMERO QUE DECIDE: o erro silencioso.");
  console.log("Abra o CSV, filtre hasInstagram=PRESENTE, abra cada perfil");
  console.log("e preencha 'verificacao_humana' com OK / ERRADO / NAO_SEI.");
  console.log("ERRADO / total_PRESENTE = erro silencioso. Limiar: <= 3%.");
}

main().catch((e) => { console.error("Erro:", e); process.exit(1); });
