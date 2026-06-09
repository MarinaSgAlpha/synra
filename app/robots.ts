import type { MetadataRoute } from 'next'

/**
 * app.mcpserver.design is the product application (login, dashboard, MCP
 * gateway endpoints) — not marketing content. Disallow all crawling so
 * search engines focus on mcpserver.design instead.
 *
 * Belt-and-braces with `robots: { index: false }` in app/layout.tsx — the
 * meta tag covers HTML pages, this covers everything else (assets, etc.).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  }
}
