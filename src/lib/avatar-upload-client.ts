const FULL_AVATAR_EDGE = 512;
const PREVIEW_AVATAR_EDGE = 16;
const ALLOWED_SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_SOURCE_AVATAR_SIZE = 10 * 1024 * 1024;

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * WebP where the browser can encode it from a canvas (Chromium, Firefox). Safari cannot and silently returns
 * PNG for a WebP request, so fall back to JPEG there; the server accepts both.
 */
async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	const webp = await encodeCanvas(canvas, "image/webp", quality);
	if (webp?.type === "image/webp") return webp;
	const jpeg = await encodeCanvas(canvas, "image/jpeg", quality);
	if (jpeg?.type === "image/jpeg") return jpeg;
	throw new Error("Unable to process this image");
}

async function resizeAvatar(image: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
	const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(image.width * scale));
	canvas.height = Math.max(1, Math.round(image.height * scale));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Unable to process this image");
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	return canvasBlob(canvas, quality);
}

export async function appendOptimizedAvatar(form: FormData, source: File): Promise<void> {
	if (!ALLOWED_SOURCE_TYPES.has(source.type)) throw new Error("Use a JPEG, PNG, WebP, or GIF image");
	if (source.size > MAX_SOURCE_AVATAR_SIZE) throw new Error("Image must be 10 MB or smaller");
	let image: ImageBitmap;
	try {
		image = await createImageBitmap(source);
	} catch {
		throw new Error("Unable to process this image");
	}
	try {
		const [full, preview] = await Promise.all([
			resizeAvatar(image, FULL_AVATAR_EDGE, 0.85),
			resizeAvatar(image, PREVIEW_AVATAR_EDGE, 0.7),
		]);
		const extension = full.type === "image/jpeg" ? "jpg" : "webp";
		form.set("file", full, `avatar.${extension}`);
		form.set("preview", preview, `avatar-preview.${extension}`);
	} finally {
		image.close();
	}
}
