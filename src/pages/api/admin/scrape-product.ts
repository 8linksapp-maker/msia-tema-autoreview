import type { APIRoute } from 'astro';

export const prerender = false;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function decode(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function match(html: string, re: RegExp): string | null {
    const m = html.match(re);
    return m ? decode(m[1]) : null;
}

function scrapeAmazon(html: string) {
    const name = match(html, /id="productTitle"[^>]*>([^<]+)</);
    const priceRaw = match(html, /class="a-offscreen">(R\$\s?[\d.,]+)</);
    const originalPriceRaw = match(html, /<span class="a-price a-text-price"[^>]*>\s*<span class="a-offscreen">(R\$\s?[\d.,]+)</);
    const image = match(html, /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/) ||
        match(html, /"large":"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/);
    const ratingRaw = match(html, /a-icon-alt">([\d,]+) de 5 estrelas/);
    const rating = ratingRaw ? parseFloat(ratingRaw.replace(',', '.')) : null;
    return {
        store: 'amazon',
        name: name || '',
        price: priceRaw || '',
        originalPrice: originalPriceRaw && originalPriceRaw !== priceRaw ? originalPriceRaw : '',
        image: image || '',
        rating: rating || 0,
    };
}

function scrapeMercadoLivre(html: string) {
    const name = match(html, /<h1[^>]*class="[^"]*ui-pdp-title[^"]*"[^>]*>([^<]+)</) ||
        match(html, /<meta property="og:title" content="([^"]+)"/);
    const priceFraction = match(html, /"price":\s*\{[^}]*"value":\s*([\d.]+)/) ||
        match(html, /class="andes-money-amount__fraction"[^>]*>([\d.]+)</);
    const price = priceFraction ? `R$ ${priceFraction.replace('.', ',')}` : '';
    const image = match(html, /<meta property="og:image" content="([^"]+)"/);
    const ratingRaw = match(html, /"averageRating":\s*([\d.]+)/) ||
        match(html, /class="ui-pdp-review__rating"[^>]*>([\d.]+)</);
    const rating = ratingRaw ? parseFloat(ratingRaw) : 0;
    return {
        store: 'mercado-livre',
        name: name || '',
        price,
        originalPrice: '',
        image: image || '',
        rating,
    };
}

function scrapeShopee(html: string) {
    const name = match(html, /<meta property="og:title" content="([^"]+)"/);
    const image = match(html, /<meta property="og:image" content="([^"]+)"/);
    return {
        store: 'shopee',
        name: name || '',
        price: '',
        originalPrice: '',
        image: image || '',
        rating: 0,
    };
}

function detectStore(url: string): 'amazon' | 'mercado-livre' | 'shopee' | 'outro' {
    const h = url.toLowerCase();
    // Amazon (incluindo shorteners oficiais amzn.to e a.co)
    if (h.includes('amazon.') || h.includes('amzn.to') || /\/\/a\.co\//.test(h)) return 'amazon';
    // Mercado Livre (incluindo shortener mercadolivr.es e mlb.la)
    if (h.includes('mercadolivre.') || h.includes('mercadolibre.') || h.includes('mercadolivr.es') || h.includes('mlb.la')) return 'mercado-livre';
    // Shopee (incluindo shortener shp.ee e s.shopee.com)
    if (h.includes('shopee.') || h.includes('shp.ee')) return 'shopee';
    return 'outro';
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const { url } = await request.json();
        if (!url || typeof url !== 'string' || !url.match(/^https?:\/\//)) {
            return new Response(JSON.stringify({ error: 'URL inválida' }), { status: 400 });
        }

        let store = detectStore(url);
        if (store === 'outro') {
            return new Response(JSON.stringify({ error: 'Loja não suportada. Use Amazon, Mercado Livre ou Shopee.' }), { status: 400 });
        }

        const res = await fetch(url, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ error: `Falha ao acessar página (HTTP ${res.status}). A loja pode estar bloqueando o servidor.` }), { status: 502 });
        }

        // Re-detect via URL final (apos redirects) para garantir que o scraper certo seja usado
        const finalUrl = res.url || url;
        const finalStore = detectStore(finalUrl);
        if (finalStore !== 'outro') store = finalStore;

        // Mercado Livre redireciona requisições de servidor (IP de datacenter) para uma
        // página de "account-verification" (parede anti-robô, HTTP 200) em vez do produto.
        // Detectar pela URL final evita devolver o erro genérico enganoso de "layout mudou".
        if (/account-verification/i.test(finalUrl)) {
            return new Response(JSON.stringify({ error: 'O Mercado Livre bloqueou a importação automática (verificação anti-robô do servidor). Preencha nome, preço e imagem manualmente — o link de afiliado continua funcionando normalmente.' }), { status: 502 });
        }

        const html = await res.text();

        if (html.length < 5000 || html.toLowerCase().includes('captcha') || html.toLowerCase().includes('robot check') || html.toLowerCase().includes('account-verification')) {
            const lojaMsg = store === 'mercado-livre'
                ? 'O Mercado Livre bloqueou a importação automática (verificação anti-robô do servidor). Preencha nome, preço e imagem manualmente — o link de afiliado continua funcionando normalmente.'
                : 'A loja bloqueou a requisição (captcha/anti-bot). Preencha manualmente.';
            return new Response(JSON.stringify({ error: lojaMsg }), { status: 502 });
        }

        let data;
        if (store === 'amazon') data = scrapeAmazon(html);
        else if (store === 'mercado-livre') data = scrapeMercadoLivre(html);
        else if (store === 'shopee') data = scrapeShopee(html);
        else throw new Error('Store não suportada');

        if (!data.name) {
            const motivo = store === 'mercado-livre'
                ? 'Não foi possível extrair os dados do produto no Mercado Livre — provavelmente a verificação anti-robô do servidor. Preencha nome, preço e imagem manualmente; o link de afiliado continua válido.'
                : 'Não foi possível extrair o nome do produto. A página pode ter mudado de layout.';
            return new Response(JSON.stringify({ error: motivo }), { status: 500 });
        }

        return new Response(JSON.stringify({ ok: true, data: { ...data, affiliateLink: url } }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || 'Erro desconhecido' }), { status: 500 });
    }
};
