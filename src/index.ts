import puppeteer from '@cloudflare/puppeteer';
import * as jose from 'jose';
import invariant from 'tiny-invariant';

interface Env {
	BROWSER: puppeteer.BrowserWorker;
	IMAGES_BUCKET: R2Bucket;
	JWT_SECRET: string;
}

const headers = {
	'Content-Type': 'image/png',
	'Cache-Control': 'public, max-age=14400',
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const secret = new TextEncoder().encode(env.JWT_SECRET);
		const jwt = url.pathname.split('/')[1];

		let payload: null | { title: string; description?: string } = null;

		try {
			const decodedJWT = await jose.jwtVerify(jwt, secret);
			payload = decodedJWT.payload as any;
		} catch (error) {
			return new Response('Unauthorized', { status: 401 });
		}

		try {
			invariant(typeof payload?.title === 'string');
			invariant(typeof payload.description === 'string' || typeof payload.description === 'undefined');
		} catch (error) {
			return new Response('Bad Request', { status: 400 });
		}

		const { title, description } = payload;
		const key = `${title?.replace(/\W/g, '-')}${description ? `___${description.replace(/\W/g, '-')}` : ''}.png`;
		const existingImage = await env.IMAGES_BUCKET.get(key);

		if (existingImage) {
			return new Response(existingImage.body, { status: 200, headers });
		}

		const params = new URLSearchParams({ title });
		if (description) {
			params.set('description', description);
		}

		const browser = await puppeteer.launch(env.BROWSER);
		const page = await browser.newPage();
		await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
		await page.goto(`https://kevinkipp.com/og-image?${params}`);
		await page.waitForNetworkIdle();
		const screenshot = await page.screenshot({ type: 'png' });
		await browser.close();
		await env.IMAGES_BUCKET.put(key, screenshot);
		return new Response(screenshot, { status: 200, headers });
	},
};
