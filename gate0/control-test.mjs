#!/usr/bin/env node
/**
 * CONTROLE POSITIVO — o teste que desambigua o resultado do Gate 0.
 *
 * Os 28 SEM_SITE deram "candidato sem corroboracao" com HTTP 200 e
 * zero bloqueios. Duas explicacoes possiveis, com decisoes opostas:
 *
 *   H1. Os handles estao errados.
 *       -> a heuristica precisa melhorar. Problema soluvel.
 *
 *   H2. O Instagram devolve login wall com status 200.
 *       -> a via nao existe. Nenhuma heuristica resolve.
 *          A decisao vira API oficial, fornecedor, ou nao fazer.
 *
 * Este script decide entre as duas usando perfis que SABEMOS existir:
 * os 3 que a camada A ja confirmou, extraidos do proprio campo
 * `website` do scraper — nao ha duvida de que sao reais nem de que
 * pertencem aqueles leads.
 *
 * Se nem esses corroboram, esta provado que e H2.
 *
 * Uso: node gate0/control-test.mjs
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Perfis confirmados pela camada A — vieram do campo website do scraper
const CONTROLES = [
  { handle: "dranataliacolassiol", lead: "Dra Natalia Colassiol", telefone: "" },
  { handle: "institutosalettee",   lead: "INSTITUTO MEDICO SALETTE", telefone: "" },
  { handle: "gz_clinica",          lead: "GZ Clinica Estetica", telefone: "" },
];

// Handle que quase certamente nao existe — mostra se o IG distingue
const INEXISTENTE = "zzz-nao-existe-" + "qwertyuiop".slice(0, 8);

const SINAIS_LOGIN_WALL = [
  "loginform", "log in to instagram", "entrar no instagram",
  "sign up for instagram", "cadastre-se no instagram",
  "you must log in", "page not found", "content isn't available",
  "esta pagina nao esta disponivel",
];

async function inspect(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const low = html.toLowerCase();
    return {
      status: res.status,
      finalUrl: res.url,
      bytes: html.length,
      loginWall: SINAIS_LOGIN_WALL.filter((s) => low.includes(s)),
      // og:title e o que aparece quando o perfil e servido de verdade
      ogTitle: (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,120})/i) || [])[1] || "",
      ogDesc: (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,160})/i) || [])[1] || "",
      html,
    };
  } catch (e) {
    return { erro: `${e.name}: ${e.message}` };
  }
}

console.log("CONTROLE POSITIVO — Instagram sem autenticacao\n");
console.log("Testando perfis que SABEMOS existir (confirmados pela camada A).");
console.log("Se nem eles trouxerem conteudo, a via nao existe.\n");
console.log("=".repeat(66));

let servidos = 0;

for (const c of CONTROLES) {
  const url = `https://www.instagram.com/${c.handle}/`;
  console.log(`\n@${c.handle}   (${c.lead})`);
  const r = await inspect(url);

  if (r.erro) { console.log(`   ERRO: ${r.erro}`); continue; }

  console.log(`   HTTP ${r.status}   ${r.bytes.toLocaleString()} bytes`);
  if (r.finalUrl !== url) console.log(`   redirecionou -> ${r.finalUrl}`);
  if (r.ogTitle) console.log(`   og:title: ${r.ogTitle}`);
  if (r.ogDesc) console.log(`   og:desc:  ${r.ogDesc.slice(0, 110)}`);
  if (r.loginWall.length) console.log(`   >> LOGIN WALL detectado: ${r.loginWall.join(", ")}`);

  const servido = r.ogTitle && !r.loginWall.length;
  if (servido) servidos++;
  console.log(`   conteudo do perfil servido? ${servido ? "SIM" : "NAO"}`);

  await new Promise((r) => setTimeout(r, 3000));
}

console.log("\n" + "-".repeat(66));
console.log(`\nControle negativo — perfil inexistente @${INEXISTENTE}`);
const neg = await inspect(`https://www.instagram.com/${INEXISTENTE}/`);
if (neg.erro) console.log(`   ERRO: ${neg.erro}`);
else {
  console.log(`   HTTP ${neg.status}   ${neg.bytes.toLocaleString()} bytes`);
  console.log(`   og:title: ${neg.ogTitle || "(vazio)"}`);
  console.log("   Se este devolve o MESMO que os reais, o Instagram nao");
  console.log("   distingue perfil existente de inexistente sem login.");
}

console.log("\n" + "=".repeat(66));
console.log("VEREDITO");
console.log("=".repeat(66));

if (servidos === CONTROLES.length) {
  console.log("H1 — os perfis SAO servidos sem login.");
  console.log("     Entao os 28 handles estavam errados, e a heuristica");
  console.log("     de nome e que precisa melhorar. Problema soluvel.");
} else if (servidos === 0) {
  console.log("H2 — nem os perfis confirmados sao servidos.");
  console.log("     Esta PROVADO que a via de scraping nao autenticado");
  console.log("     nao existe. Nenhuma heuristica de nome resolve isso.");
  console.log("");
  console.log("     O resultado '0/28' do Gate 0 NAO significa que os leads");
  console.log("     nao tem Instagram. Significa que este metodo nao ve.");
  console.log("");
  console.log("     Decisao: API oficial (Instagram Graph exige que o perfil");
  console.log("     seja business e vinculado a uma pagina que voce administra),");
  console.log("     fornecedor pago, ou assumir DESCONHECIDO na v0.2 e dizer");
  console.log("     isso no roadmap.");
} else {
  console.log(`Parcial: ${servidos}/${CONTROLES.length} servidos.`);
  console.log("     Comportamento inconsistente — provavelmente rate limit");
  console.log("     progressivo. Rode de novo daqui a alguns minutos.");
}
console.log("");
