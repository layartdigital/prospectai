import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'pa_at';
const REFRESH_COOKIE = 'pa_rt';

/**
 * `/invite` é público por necessidade: quem foi convidado ainda não tem conta.
 * O token no caminho é a credencial, e ele expira em sete dias.
 */
const PUBLIC_ROUTES = ['/login', '/register', '/invite'];

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3101';

/**
 * Proteção de rota e renovação de sessão.
 *
 * O access token vive 15 minutos; o navegador apaga o cookie sozinho quando
 * ele expira. Isso deixa um estado detectável — refresh presente, access
 * ausente — que é exatamente quando a sessão deve ser renovada.
 *
 * Sem esse passo o resultado é um laço de redirecionamento: o middleware vê
 * o refresh e libera a página, a API rejeita o access expirado com 401, o
 * layout manda para /login, e o middleware devolve para /dashboard.
 *
 * A verificação aqui é de presença, não de assinatura: validar JWT no edge
 * exigiria o segredo fora da API, e a API já valida a cada requisição.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const hasRefresh = request.cookies.has(REFRESH_COOKIE);
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (isPublic) {
    // Só desvia quem tem sessão utilizável. Com apenas o refresh, deixa a
    // tela de login aparecer em vez de tentar renovar em laço.
    if (hasAccess) return redirectTo(request, '/dashboard');
    return NextResponse.next();
  }

  if (hasAccess) return NextResponse.next();

  if (hasRefresh) {
    const renewed = await renewSession(request);
    if (renewed) return renewed;
    // Refresh inválido ou revogado: limpa e manda para o login.
    return clearSessionAndRedirect(request);
  }

  return redirectTo(request, '/login', pathname);
}

async function renewSession(request: NextRequest): Promise<NextResponse | null> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;

  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const next = NextResponse.next();

    // Repassa os cookies novos da API para o navegador. Sem isto a renovação
    // acontece a cada requisição, em vez de uma vez a cada 15 minutos.
    for (const value of response.headers.getSetCookie()) {
      next.headers.append('set-cookie', value);
    }

    return next;
  } catch {
    // API fora do ar. Tratado como falha de renovação.
    return null;
  }
}

function redirectTo(
  request: NextRequest,
  pathname: string,
  next?: string,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  // Preserva o destino para devolver o usuário onde ele estava tentando ir.
  if (next && next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

function clearSessionAndRedirect(request: NextRequest): NextResponse {
  const response = redirectTo(request, '/login');
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
