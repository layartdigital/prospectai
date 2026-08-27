#!/usr/bin/env python3
"""
GATE 0 — Medir a ponte CNPJ -> domínio.

Este script NÃO é o produto. É o instrumento de medição que decide
se o produto pode existir. Ver README.md.

Estratégias, em ordem de força:

  1. EMAIL_RFB       — o cadastro da Receita traz e-mail. Um e-mail
                       corporativo (nao-gratuito) revela o domínio.
                       É o método determinístico mais forte de graça.
  2. NOME_HEURISTICA — normaliza razão social / nome fantasia e testa
                       candidatos (.com.br, .com).
  3. BUSCA           — deixado como stub: exige API de busca paga.

Verificação (o que torna a medição honesta):

  CNPJ_NO_SITE — se a página do candidato contém o CNPJ consultado,
                 o mapeamento está CONFIRMADO sem opinião humana.
                 Muitos sites brasileiros trazem o CNPJ no rodapé.
                 Esta é a diferença entre "medi" e "achei que sim".

Saída: CSV com veredito por CNPJ, para conferência manual da amostra.

Uso:
    python3 resolve_domains.py cnpjs.txt --out resultado.csv
    python3 resolve_domains.py cnpjs.txt --out resultado.csv --limit 50

Dependências: requests
    pip install requests
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Falta a dependência: pip install requests")


# --------------------------------------------------------------------------
# Configuração
# --------------------------------------------------------------------------

# API pública e gratuita de consulta de CNPJ.
# Alternativas (troque se uma estiver instável ou rate-limited):
#   https://open.cnpja.com/office/{cnpj}     -> 5 req/min por IP
#   https://brasilapi.com.br/api/cnpj/v1/{cnpj}
#   https://minhareceita.org/{cnpj}
API_URL = "https://open.cnpja.com/office/{cnpj}"

# Respeite o rate limit. 5 req/min = 12s. Ajuste conforme a API escolhida.
API_DELAY_SECONDS = 13.0

# Timeout ao buscar o site candidato.
SITE_TIMEOUT = 10

# User-Agent identificável. Não se esconda — é postura, e reduz bloqueio.
USER_AGENT = "ProspectAI-Gate0/1.0 (medicao de viabilidade; contato via site)"

# Provedores de e-mail gratuitos: o domínio NÃO é da empresa.
FREE_EMAIL_DOMAINS = {
    "gmail.com", "hotmail.com", "outlook.com", "outlook.com.br", "yahoo.com",
    "yahoo.com.br", "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br",
    "globo.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com",
    "zipmail.com.br", "oi.com.br", "r7.com", "protonmail.com", "yandex.com",
}

# Termos societários que não ajudam a formar o domínio.
CORPORATE_STOPWORDS = {
    "ltda", "me", "epp", "eireli", "sa", "s a", "s/a", "cia", "companhia",
    "comercio", "servicos", "industria", "e", "de", "da", "do", "das", "dos",
    "empreendimentos", "participacoes", "holding", "sociedade", "limitada",
    "individual", "responsabilidade", "simples", "unipessoal",
}

CACHE_DIR = Path(".gate0_cache")


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

def only_digits(s):
    return re.sub(r"\D", "", s or "")


def normalize(text):
    """Remove acentos, baixa a caixa, tira pontuação."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def format_cnpj(cnpj):
    d = only_digits(cnpj)
    if len(d) != 14:
        return cnpj
    return f"{d[0:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:14]}"


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


# --------------------------------------------------------------------------
# Passo 1 — consultar o cadastro
# --------------------------------------------------------------------------

def fetch_company(sess, cnpj):
    """Consulta a API pública. Cacheia em disco para não repetir chamada."""
    digits = only_digits(cnpj)
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{digits}.json"

    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8")), True
        except Exception:
            pass

    url = API_URL.format(cnpj=digits)
    try:
        resp = sess.get(url, timeout=20)
    except requests.RequestException as e:
        return {"_error": f"request_failed: {e}"}, False

    if resp.status_code == 429:
        return {"_error": "rate_limited"}, False
    if resp.status_code != 200:
        return {"_error": f"http_{resp.status_code}"}, False

    try:
        data = resp.json()
    except ValueError:
        return {"_error": "invalid_json"}, False

    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data, False


def extract_fields(data):
    """
    Extrai os campos que interessam, tolerando formatos diferentes
    entre CNPJá / BrasilAPI / Minha Receita.
    """
    if not data or "_error" in data:
        return {}

    company = data.get("company") or {}
    out = {
        "razao_social": (
            company.get("name")
            or data.get("razao_social")
            or data.get("nome_empresarial")
            or ""
        ),
        "nome_fantasia": (
            data.get("alias")
            or data.get("nome_fantasia")
            or data.get("fantasia")
            or ""
        ),
        "municipio": "",
        "uf": "",
        "emails": [],
    }

    addr = data.get("address") or {}
    out["municipio"] = addr.get("city") or data.get("municipio") or ""
    out["uf"] = addr.get("state") or data.get("uf") or ""

    # e-mails: formatos variados
    emails = []
    for e in data.get("emails") or []:
        if isinstance(e, dict):
            emails.append(e.get("address", ""))
        elif isinstance(e, str):
            emails.append(e)
    for key in ("email", "correio_eletronico"):
        if data.get(key):
            emails.append(data[key])
    out["emails"] = [e.strip().lower() for e in emails if e and "@" in e]

    return out


# --------------------------------------------------------------------------
# Passo 2 — gerar candidatos de domínio
# --------------------------------------------------------------------------

def domain_from_email(emails):
    """Estratégia 1: e-mail corporativo no cadastro da Receita."""
    for email in emails:
        domain = email.split("@")[-1].strip().lower()
        if not domain or "." not in domain:
            continue
        if domain in FREE_EMAIL_DOMAINS:
            continue
        return domain
    return None


def candidates_from_name(razao_social, nome_fantasia):
    """Estratégia 2: heurística sobre o nome."""
    candidates = []
    for raw in (nome_fantasia, razao_social):
        norm = normalize(raw)
        if not norm:
            continue
        tokens = [t for t in norm.split() if t not in CORPORATE_STOPWORDS and len(t) > 1]
        if not tokens:
            continue
        for base in (
            "".join(tokens),          # nomecompleto
            "".join(tokens[:2]),      # duas primeiras
            tokens[0],                # primeira
        ):
            if len(base) < 3 or len(base) > 40:
                continue
            for tld in (".com.br", ".com"):
                cand = base + tld
                if cand not in candidates:
                    candidates.append(cand)
    return candidates[:6]


# --------------------------------------------------------------------------
# Passo 3 — verificar
# --------------------------------------------------------------------------

def check_site(sess, domain, cnpj_digits):
    """
    Busca o site e procura o CNPJ no HTML.

    Retorna: (status, cnpj_encontrado, titulo)
      status: 'ok' | 'sem_resposta' | 'erro'
    """
    for scheme in ("https://", "http://"):
        url = scheme + domain
        try:
            resp = sess.get(url, timeout=SITE_TIMEOUT, allow_redirects=True)
        except requests.RequestException:
            continue

        if resp.status_code >= 400:
            continue

        html = resp.text[:400_000]
        html_digits = only_digits(html)
        found = cnpj_digits in html_digits

        m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        title = re.sub(r"\s+", " ", m.group(1)).strip()[:120] if m else ""

        return "ok", found, title

    return "sem_resposta", False, ""


# --------------------------------------------------------------------------
# Orquestração
# --------------------------------------------------------------------------

def resolve_one(sess, cnpj):
    digits = only_digits(cnpj)
    row = {
        "cnpj": format_cnpj(digits),
        "razao_social": "",
        "nome_fantasia": "",
        "municipio": "",
        "uf": "",
        "metodo": "",
        "dominio": "",
        "site_responde": "",
        "cnpj_no_site": "",
        "titulo_site": "",
        "veredito": "",
        "confianca": "",
        "verificacao_humana": "",   # preencher à mão: OK | ERRADO | NAO_SEI
        "observacao": "",
    }

    if len(digits) != 14:
        row["veredito"] = "CNPJ_INVALIDO"
        return row, True

    data, from_cache = fetch_company(sess, digits)
    if "_error" in data:
        row["veredito"] = "ERRO_API"
        row["observacao"] = data["_error"]
        return row, from_cache

    fields = extract_fields(data)
    row.update({
        "razao_social": fields.get("razao_social", ""),
        "nome_fantasia": fields.get("nome_fantasia", ""),
        "municipio": fields.get("municipio", ""),
        "uf": fields.get("uf", ""),
    })

    # Estratégia 1 — e-mail corporativo
    email_domain = domain_from_email(fields.get("emails", []))
    tried = []

    if email_domain:
        status, found, title = check_site(sess, email_domain, digits)
        tried.append(email_domain)
        row.update({
            "metodo": "EMAIL_RFB",
            "dominio": email_domain,
            "site_responde": "sim" if status == "ok" else "nao",
            "cnpj_no_site": "sim" if found else "nao",
            "titulo_site": title,
        })
        if status == "ok" and found:
            row["veredito"] = "CONFIRMADO"
            row["confianca"] = "alta"
            return row, from_cache
        if status == "ok":
            row["veredito"] = "CANDIDATO"
            row["confianca"] = "media"
            # e-mail corporativo é sinal forte mesmo sem CNPJ no site
            return row, from_cache

    # Estratégia 2 — heurística de nome
    for cand in candidates_from_name(fields.get("razao_social"), fields.get("nome_fantasia")):
        if cand in tried:
            continue
        tried.append(cand)
        status, found, title = check_site(sess, cand, digits)
        if status != "ok":
            continue
        row.update({
            "metodo": "NOME_HEURISTICA",
            "dominio": cand,
            "site_responde": "sim",
            "cnpj_no_site": "sim" if found else "nao",
            "titulo_site": title,
        })
        if found:
            row["veredito"] = "CONFIRMADO"
            row["confianca"] = "alta"
        else:
            # ATENÇÃO: este é o balde do erro silencioso.
            # Site existe, nome parece, e nada prova que é a empresa certa.
            row["veredito"] = "CANDIDATO"
            row["confianca"] = "baixa"
        return row, from_cache

    row["veredito"] = "NAO_RESOLVIDO"
    row["confianca"] = "-"
    row["observacao"] = f"tentados: {', '.join(tried) if tried else 'nenhum candidato'}"
    return row, from_cache


def main():
    ap = argparse.ArgumentParser(description="Gate 0 — medir CNPJ -> domínio")
    ap.add_argument("input", help="arquivo com um CNPJ por linha")
    ap.add_argument("--out", default="gate0_resultado.csv")
    ap.add_argument("--limit", type=int, default=0, help="parar após N CNPJs")
    ap.add_argument("--delay", type=float, default=API_DELAY_SECONDS,
                    help=f"segundos entre chamadas de API (padrão {API_DELAY_SECONDS})")
    args = ap.parse_args()

    cnpjs = []
    for line in Path(args.input).read_text(encoding="utf-8").splitlines():
        d = only_digits(line)
        if len(d) == 14:
            cnpjs.append(d)
    if args.limit:
        cnpjs = cnpjs[:args.limit]

    if not cnpjs:
        sys.exit("Nenhum CNPJ válido no arquivo de entrada.")

    print(f"Processando {len(cnpjs)} CNPJs. Delay de API: {args.delay}s.")
    est = len(cnpjs) * args.delay / 60
    print(f"Tempo estimado: ~{est:.0f} min (menos, com cache).\n")

    sess = session()
    rows = []

    for i, cnpj in enumerate(cnpjs, 1):
        result = resolve_one(sess, cnpj)
        if isinstance(result, tuple):
            row, from_cache = result
        else:
            row, from_cache = result, False
        rows.append(row)

        print(f"[{i}/{len(cnpjs)}] {row['cnpj']} "
              f"{row['veredito']:<14} {row['dominio'] or '-'}")

        if not from_cache and i < len(cnpjs):
            time.sleep(args.delay)

    fieldnames = list(rows[0].keys())
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    # ---- Sumário ----
    total = len(rows)
    conf = sum(1 for r in rows if r["veredito"] == "CONFIRMADO")
    cand = sum(1 for r in rows if r["veredito"] == "CANDIDATO")
    nao = sum(1 for r in rows if r["veredito"] == "NAO_RESOLVIDO")
    err = sum(1 for r in rows if r["veredito"] in ("ERRO_API", "CNPJ_INVALIDO"))
    cand_baixa = sum(1 for r in rows if r["veredito"] == "CANDIDATO"
                     and r["confianca"] == "baixa")

    print("\n" + "=" * 58)
    print("RESULTADO — GATE 0")
    print("=" * 58)
    print(f"Total processado ........... {total}")
    print(f"CONFIRMADO (CNPJ no site) .. {conf:>4}  ({conf/total*100:.1f}%)")
    print(f"CANDIDATO (nao provado) .... {cand:>4}  ({cand/total*100:.1f}%)")
    print(f"  dos quais confianca baixa  {cand_baixa:>4}  <-- risco de erro silencioso")
    print(f"NAO_RESOLVIDO .............. {nao:>4}  ({nao/total*100:.1f}%)")
    print(f"Erros de API/entrada ....... {err:>4}")
    print("=" * 58)
    print(f"\nCSV: {args.out}")
    print("\nO NUMERO QUE DECIDE ainda nao esta aqui.")
    print("Abra o CSV, filtre veredito=CANDIDATO e preencha")
    print("'verificacao_humana' com OK / ERRADO / NAO_SEI.")
    print("A taxa de ERRADO nessa coluna e o erro silencioso.")
    print("Ver README.md, secao 'Como interpretar'.")


if __name__ == "__main__":
    main()
