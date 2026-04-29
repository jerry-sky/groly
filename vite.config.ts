import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function allowedHosts(): string[] {
    const out = [];
	if (process.env.ORIGIN) {
		out.push(process.env.ORIGIN.replace(/https?:\/\//, ''));
	} else {
		out.push('localhost');
	}
    return out;
}

export default defineConfig({
	server: {
		allowedHosts: allowedHosts(),
	},
	plugins: [
		tailwindcss(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			isServer: 'import.meta.env.SSR'
		}),
		sveltekit(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.ts',
			registerType: 'autoUpdate',
			manifest: {
				name: 'Groly',
				short_name: 'Groly',
				description: 'Einkaufslisten App',
				theme_color: '#0a0f0e',
				background_color: '#0a0f0e',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				scope: '/',
				id: '/',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					{ src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
				],
				share_target: {
					action: '/rezepte/import',
					method: 'GET',
					params: { url: 'url' }
				}
			},
			injectManifest: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']
			}
		})
	]
});
