#!/usr/bin/env python3
"""
GATE 0 — Descoberta de sinais sociais a partir de um lead do Google Maps.

Mede se a v0.2 e viavel: dado um lead do scraper, com que taxa
consigo DESCOBRIR e VERIFICAR Instagram e Facebook — e com que taxa
de erro silencioso.

Le o CSV do gosom/google-maps-scraper (data/gmapsdata/*.csv).

TRES CAMADAS, em ordem de forca:

  A. SCRAPER      — o "site" do lead ja e a rede social.
                    Ex: website = instagram.com/clinicaxyz
                    Custo zero. Confianca maxima.

  B. SITE         — o site proprio do lead linka para as redes.
                    <a href="instagram.com/...">  no HTML.
                    Deterministico. Sem palpite.

  C. HANDLE       — heuristica sobre o nome + verificacao.
                    Tenta instagram.com/{handle-derivado-do-nome}.
                    So vira PRESENTE com CORROBORACAO (telefone na pagina).
                    Sem corroboracao: fica DESCONHECIDO.

REGRA FUNDADORA (do scoring.md deste projeto):
    "O score so pontua o que foi efetivamente observado."

    Nada aqui vira AUSENTE. Nunca. Nao encontrar um perfil nao prova
    que ele nao existe. A saida so tem PRESENTE ou DESCONHECIDO.

O QUE ESTE SCRIPT MEDE DE VERDADE:
    Nao e so a taxa de acerto. E se a via TECNICA existe.
    Instagram e Facebook bloqueiam acesso nao autenticado de forma
    agressiva. Se a camada C retornar BLOQUEADO em massa, o resultado
    do gate nao e "descoberta baixa" — e "esta via nao existe", e a
    decisao vira usar API oficial/fornecedor, ou nao fazer.
    Por isso BLOQUEADO e NAO_ENCONTRADO sao contados separadamente.

Uso:
    python measure_social.py data/gmapsdata/*.csv --out gate0_social.csv
    python measure_social.py entrada.csv --limit 30
    python measure_social.py entrada.csv --skip-handle   # so camadas A e B

Dependencias: requests
"""

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Falta a dependencia: pip install requests")


# --------------------------------------------------------------------------
# Configuracao
# --------------------------------------------------------------------------

SITE_TIMEOUT = 12
SOCIAL_TIMEOUT = 12
DELAY_SITE = 1.0       # entre buscas de site proprio
DELAY_SOCIAL = 3.0     # entre tentativas em rede social — seja educado

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/125.0 Safari/537.36")

# Dominios que o scoring.md classifica como SITE_PRECARIO
PRECARIO = [
    "base44.app", "wixsite.com", "negocio.site", "blogspot.com",
    "wordpress.com", "linktr.ee", "instagram.com", "facebook.com",
    "linkbio.co", "beacons.ai", "bio.link",
]

# Handles genericos que nunca sao o perfil do lead
INSTAGRAM_IGNORE = {
    "explore", "accounts", "p", "reel", "reels", "stories", "direct",
    "about", "developer", "legal", "privacy", "instagram", "tv", "help",
}
FACEBOOK_IGNORE = {
    "sharer", "share", "dialog", "plugins", "tr", "pages", "profile.php",
    "groups", "events", "watch", "marketplace", "help", "policies",
    "facebook", "login", "sharer.php",
}

STOPWORDS = {
    "dr", "dra", "clinica", "consultorio", "centro", "instituto", "espaco",
    "studio", "ltda", "me", "epp", "eireli", "sa", "e", "de", "da", "do",
    "das", "dos", "em", "the",
}


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

def normalize(text):
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def phone_digits(phone):
    """
    Normaliza telefone brasileiro para comparacao.

    So gera formas SEMANTICAMENTE VALIDAS — DDD+numero completo, ou
    numero sem DDD. Fatiar arbitrariamente ('os ultimos 10 digitos')
    produz sequencias que nao sao telefone nenhum e podem casar por
    acaso numa pagina, inflando a corroboracao com falso positivo.
    """
    d = re.sub(r"\D", "", phone or "")
    if not d:
        return []

    if d.startswith("55") and len(d) in (12, 13):
        d = d[2:]                      # tira codigo do pais

    formas = set()
    if len(d) in (10, 11):             # DDD + 8 ou 9 digitos
        formas.add(d)
        formas.add(d[2:])              # so o numero, sem DDD
    elif len(d) in (8, 9):             # ja veio sem DDD
        formas.add(d)

    return sorted(formas, key=len, reverse=True)


def city_from_row(row):
    raw = row.get("complete_address") or ""
    try:
        return (json.loads(raw) or {}).get("city", "") if raw else ""
    except (ValueError, TypeError):
        return ""


def classify_website(website):
    w = (website or "").strip()
    if not w:
        return "SEM_SITE"
    low = w.lower()
    if any(p in low for p in PRECARIO):
        return "SITE_PRECARIO"
    return "SITE_PROPRIO"


def make_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "pt-BR,pt;q=0.9",
    })
    return s


# --------------------------------------------------------------------------
# Extracao de perfis a partir de HTML
# --------------------------------------------------------------------------

RE_INSTAGRAM = re.compile(
    r"(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9_.]{1,30})", re.I)
RE_FACEBOOK = re.compile(
    r"(?:https?://)?(?:www\.|m\.|pt-br\.)?facebook\.com/([A-Za-z0-9_.\-]{1,60})", re.I)


def extract_profiles(html):
    """Extrai o primeiro handle plausivel de Instagram e Facebook do HTML."""
    insta = fb = None

    for m in RE_INSTAGRAM.finditer(html):
        h = m.group(1).strip(".").lower()
        if h and h not in INSTAGRAM_IGNORE and not h.endswith(".php"):
            insta = h
            break

    for m in RE_FACEBOOK.finditer(html):
        h = m.group(1).strip(".").lower()
        if h and h not in FACEBOOK_IGNORE and not h.endswith(".php"):
            fb = h
            break

    return insta, fb


def fetch(sess, url, timeout):
    """
    Retorna (status, html).
    status: 'ok' | 'bloqueado' | 'sem_resposta'
    """
    for candidate in ([url] if url.startswith("http") else
                      ["https://" + url, "http://" + url]):
        try:
            r = sess.get(candidate, timeout=timeout, allow_redirects=True)
        except requests.RequestException:
            continue
        if r.status_code in (401, 403, 429):
            return "bloqueado", ""
        if r.status_code >= 400:
            continue
        return "ok", r.text[:600_000]
    return "sem_resposta", ""


# --------------------------------------------------------------------------
# Camada C — heuristica de handle + corroboracao
# --------------------------------------------------------------------------

def handle_candidates(title, category=""):
    """
    Deriva handles plausiveis do nome do negocio, do MAIS provavel
    para o menos.

    A categoria e removida do nome: "Dra. Cintia Guedes - Dermatologista"
    quase nunca vira @cintiaguedesdermatologista. Vira @dracintiaguedes
    ou @cintiaguedes. Ordem errada faz o script parar no primeiro perfil
    que responde, que pode ser o menos provavel — e a medicao sai torta.
    """
    palavras = normalize(title).split()
    prefixo = "dra" if "dra" in palavras else ("dr" if "dr" in palavras else "")

    # remove termos da categoria do nome
    cat_tokens = set(normalize(category).split()) - STOPWORDS
    base = [t for t in palavras if t not in STOPWORDS and len(t) > 1]
    tokens = [t for t in base if t not in cat_tokens]

    # Fallback: em nomes como "Pet Shop do Ze" na categoria "Pet shop",
    # a categoria consome o nome inteiro. Melhor tentar com o nome
    # completo do que nao tentar nada.
    if not tokens or len("".join(tokens[:2])) < 3:
        tokens = base
    if not tokens:
        return []

    nome_curto = "".join(tokens[:2])
    nome_todo = "".join(tokens)

    ordenados = []
    if prefixo:
        ordenados.append(prefixo + nome_curto)      # @dracintiaguedes
    ordenados.append(nome_curto)                    # @cintiaguedes
    if nome_todo != nome_curto:
        if prefixo:
            ordenados.append(prefixo + nome_todo)
        ordenados.append(nome_todo)

    vistos, saida = set(), []
    for c in ordenados:
        if 3 <= len(c) <= 30 and c not in vistos:
            vistos.add(c)
            saida.append(c)
    return saida[:4]


def verify_profile(sess, url, phones, title):
    """
    Busca a pagina do perfil e procura corroboracao.

    Retorna (status, corroborado, motivo)
      status: 'ok' | 'bloqueado' | 'sem_resposta'
    """
    status, html = fetch(sess, url, SOCIAL_TIMEOUT)
    if status != "ok":
        return status, False, status

    page_digits = re.sub(r"\D", "", html)

    # Corroboracao forte: telefone do lead aparece na pagina
    for p in phones:
        if len(p) >= 10 and p in page_digits:
            return "ok", True, f"telefone {p}"

    # Corroboracao fraca: nome do negocio aparece no titulo/descricao
    norm_title = normalize(title)
    tokens = [t for t in norm_title.split() if t not in STOPWORDS and len(t) > 2]
    if tokens:
        norm_html = normalize(html[:20_000])
        hits = sum(1 for t in tokens if t in norm_html)
        if hits >= max(2, len(tokens) // 2):
            return "ok", False, f"nome ({hits}/{len(tokens)} tokens) — FRACO"

    return "ok", False, "sem corroboracao"


# --------------------------------------------------------------------------
# Processamento de um lead
# --------------------------------------------------------------------------

def process(sess, row, skip_handle=False):
    title = (row.get("title") or "").strip()
    website = (row.get("website") or "").strip()
    phone = (row.get("phone") or "").strip()
    phones = phone_digits(phone)
    faixa = classify_website(website)

    out = {
        "title": title,
        "category": (row.get("category") or "").strip(),
        "city": city_from_row(row),
        "faixa_site": faixa,
        "website": website,
        "phone": phone,
        "camada": "",
        "instagram": "",
        "facebook": "",
        "corroboracao": "",
        "hasInstagram": "DESCONHECIDO",
        "hasFacebook": "DESCONHECIDO",
        "status_tecnico": "",
        "verificacao_humana": "",   # preencher a mao: OK | ERRADO | NAO_SEI
        "observacao": "",
    }

    # ---- Camada A: o proprio website ja e a rede social ----
    if faixa == "SITE_PRECARIO":
        insta, fb = extract_profiles(website)
        if insta or fb:
            out.update({
                "camada": "A_SCRAPER",
                "instagram": f"instagram.com/{insta}" if insta else "",
                "facebook": f"facebook.com/{fb}" if fb else "",
                "hasInstagram": "PRESENTE" if insta else "DESCONHECIDO",
                "hasFacebook": "PRESENTE" if fb else "DESCONHECIDO",
                "corroboracao": "veio do scraper",
                "status_tecnico": "ok",
            })
            return out

    # ---- Camada B: extrair do site proprio ----
    if website:
        status, html = fetch(sess, website, SITE_TIMEOUT)
        out["status_tecnico"] = status
        if status == "ok":
            insta, fb = extract_profiles(html)
            if insta or fb:
                out.update({
                    "camada": "B_SITE",
                    "instagram": f"instagram.com/{insta}" if insta else "",
                    "facebook": f"facebook.com/{fb}" if fb else "",
                    "hasInstagram": "PRESENTE" if insta else "DESCONHECIDO",
                    "hasFacebook": "PRESENTE" if fb else "DESCONHECIDO",
                    "corroboracao": "link no site do lead",
                })
                return out
            out["observacao"] = "site respondeu, sem link para redes"
        time.sleep(DELAY_SITE)

    # ---- Camada C: heuristica de handle ----
    if skip_handle:
        out["camada"] = "C_PULADA"
        return out

    for cand in handle_candidates(title, out["category"]):
        url = f"https://www.instagram.com/{cand}/"
        status, corroborado, motivo = verify_profile(sess, url, phones, title)
        time.sleep(DELAY_SOCIAL)

        if status == "bloqueado":
            out.update({
                "camada": "C_HANDLE",
                "status_tecnico": "bloqueado",
                "observacao": "Instagram bloqueou acesso nao autenticado",
            })
            return out

        if status == "ok":
            out["instagram"] = f"instagram.com/{cand}"
            out["camada"] = "C_HANDLE"
            out["corroboracao"] = motivo
            if corroborado:
                out["hasInstagram"] = "PRESENTE"
                out["status_tecnico"] = "ok"
            else:
                # perfil existe mas nada prova que e do lead
                out["hasInstagram"] = "DESCONHECIDO"
                out["status_tecnico"] = "ok"
                out["observacao"] = "candidato SEM corroboracao — nao promover"
            return out

    out["camada"] = "C_HANDLE"
    out["status_tecnico"] = out["status_tecnico"] or "nao_encontrado"
    return out


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Gate 0 — sinais sociais")
    ap.add_argument("input", help="CSV do google-maps-scraper")
    ap.add_argument("--out", default="gate0_social.csv")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-handle", action="store_true",
                    help="so camadas A e B (rapido, sem tocar em rede social)")
    args = ap.parse_args()

    csv.field_size_limit(10**7)
    with open(args.input, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        sys.exit("CSV vazio.")

    # Estratificacao: garante presenca dos SEM_SITE, que sao o teste real
    sem_site = [r for r in rows if classify_website(r.get("website")) == "SEM_SITE"]
    outros = [r for r in rows if classify_website(r.get("website")) != "SEM_SITE"]

    if args.limit:
        n_sem = min(len(sem_site), max(1, args.limit * 2 // 3))
        n_out = args.limit - n_sem
        amostra = sem_site[:n_sem] + outros[:n_out]
    else:
        amostra = sem_site + outros

    print(f"Total no CSV: {len(rows)}")
    print(f"Amostra: {len(amostra)}  "
          f"(SEM_SITE: {sum(1 for r in amostra if classify_website(r.get('website')) == 'SEM_SITE')})")
    if not args.skip_handle:
        print("Camada C ativa — vai tocar no Instagram. Use --skip-handle para pular.")
    print()

    sess = make_session()
    results = []
    for i, row in enumerate(amostra, 1):
        r = process(sess, row, skip_handle=args.skip_handle)
        results.append(r)
        marca = "OK " if r["hasInstagram"] == "PRESENTE" or r["hasFacebook"] == "PRESENTE" else "   "
        print(f"[{i}/{len(amostra)}] {marca} {r['faixa_site']:<14} "
              f"{r['camada']:<10} {r['title'][:42]}")

    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)

    # ---------------- Sumario ----------------
    total = len(results)
    por_faixa = Counter(r["faixa_site"] for r in results)
    por_camada = Counter(r["camada"] for r in results)
    bloqueados = sum(1 for r in results if r["status_tecnico"] == "bloqueado")
    presentes = sum(1 for r in results
                    if r["hasInstagram"] == "PRESENTE" or r["hasFacebook"] == "PRESENTE")
    candidatos = sum(1 for r in results
                     if r["camada"] == "C_HANDLE" and r["instagram"]
                     and r["hasInstagram"] != "PRESENTE")

    sem_site_res = [r for r in results if r["faixa_site"] == "SEM_SITE"]
    ss_presentes = sum(1 for r in sem_site_res
                       if r["hasInstagram"] == "PRESENTE" or r["hasFacebook"] == "PRESENTE")

    print("\n" + "=" * 62)
    print("RESULTADO — GATE 0 (sinais sociais)")
    print("=" * 62)
    print(f"Total processado ............... {total}")
    for faixa, n in por_faixa.most_common():
        print(f"  {faixa:<16} {n:>4}")
    print()
    print("Por camada de descoberta:")
    for c, n in por_camada.most_common():
        print(f"  {c:<16} {n:>4}")
    print()
    print(f"PRESENTE (corroborado) ......... {presentes:>4}  ({presentes/total*100:.0f}%)")
    print(f"Candidato sem corroboracao ..... {candidatos:>4}  (fica DESCONHECIDO)")
    print(f"Bloqueado pela plataforma ...... {bloqueados:>4}")
    print()
    if sem_site_res:
        pct = ss_presentes / len(sem_site_res) * 100
        print(f"** SEM_SITE — o que decide **")
        print(f"   {ss_presentes}/{len(sem_site_res)} resolvidos ({pct:.0f}%)   limiar: >= 40%")
        print(f"   {'PASSA' if pct >= 40 else 'NAO PASSA'}")
    print("=" * 62)

    if bloqueados > total * 0.3:
        print("\n!! ATENCAO: mais de 30% bloqueado pela plataforma.")
        print("   O resultado NAO e 'descoberta baixa' — e 'esta via nao existe'.")
        print("   A decisao vira: API oficial, fornecedor pago, ou nao fazer.")

    print(f"\nCSV: {args.out}")
    print("\nFALTA O NUMERO QUE DECIDE: o erro silencioso.")
    print("Abra o CSV, filtre hasInstagram=PRESENTE, abra cada perfil")
    print("e preencha 'verificacao_humana' com OK / ERRADO / NAO_SEI.")
    print("ERRADO / total_PRESENTE = erro silencioso. Limiar: <= 3%.")


if __name__ == "__main__":
    main()
