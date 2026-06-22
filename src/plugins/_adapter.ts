/**
 * _adapter.ts — Walker template adapter for plugins
 *
 * ÚNICO arquivo que muda por template. Todos os plugins chamam o adapter —
 * nunca escrevem posts ou leem dados diretamente.
 *
 * Normaliza:
 *   - PostData: estrutura de dados de um post
 *   - serializePost(): converte PostData → string de arquivo .md
 *   - postPath(): caminho do arquivo de um post
 */

import { yamlEscape } from '../lib/yamlEscape';

export interface PostData {
    title: string;
    slug: string;
    description: string;
    content: string;       // HTML ou Markdown (salvo como body do .md)
    image?: string;
    category?: string;
    author?: string;
    pubDate?: string;
    draft?: boolean;
}

export const config = {
    contentDir: 'src/content/blog',
    contentExtension: '.md',
    dataDir: 'src/data',
};

/**
 * Serializa um PostData para o formato .md do Walker (frontmatter YAML + body).
 * Mesmo formato gerado pelo PostEditor.tsx:130.
 */
export function serializePost(post: PostData): string {
    const title = yamlEscape(post.title);
    const description = yamlEscape(post.description);
    const pubDate = yamlEscape(post.pubDate || new Date().toISOString().split('T')[0]);
    const image = yamlEscape(post.image);
    const category = yamlEscape(post.category);
    const author = yamlEscape(post.author);
    const draft = post.draft ?? false;

    return `---\ntitle: "${title}"\ndescription: "${description}"\npubDate: "${pubDate}"\nimage: "${image}"\ncategory: "${category}"\nauthor: "${author}"\ndraft: ${draft}\n---\n${post.content}`;
}

/** Retorna o caminho relativo do arquivo de um post dado seu slug */
export function postPath(slug: string): string {
    return `${config.contentDir}/${slug}${config.contentExtension}`;
}
