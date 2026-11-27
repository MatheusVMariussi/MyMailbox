const MAX_STORED_AVATAR_SIZE = 1024 * 1024;
const MAX_PREVIEW_AVATAR_SIZE = 32 * 1024;

export function avatarPreviewKeyFor(key: string): string {
	return `${key}:preview`;
}

/** Encodings the browser may produce: WebP where canvas can encode it, JPEG where it cannot (Safari). */
export type AvatarContentType = "image/webp" | "image/jpeg";

async function hasSignature(file: File, type: AvatarContentType): Promise<boolean> {
	const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	if (type === "image/jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
	const ascii = (start: number, end: number) => String.fromCharCode(...head.slice(start, end));
	return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

function avatarContentType(type: string): AvatarContentType | null {
	return type === "image/webp" || type === "image/jpeg" ? type : null;
}

export async function getOptimizedAvatarFiles(
	form: FormData,
): Promise<{ full: File; preview: File; contentType: AvatarContentType } | null> {
	const full = form.get("file");
	const preview = form.get("preview");
	if (!(full instanceof File) || !(preview instanceof File)) return null;
	const contentType = avatarContentType(full.type);
	if (!contentType || preview.type !== contentType) return null;
	if (!full.size || full.size > MAX_STORED_AVATAR_SIZE) return null;
	if (!preview.size || preview.size > MAX_PREVIEW_AVATAR_SIZE) return null;
	if (!(await hasSignature(full, contentType)) || !(await hasSignature(preview, contentType))) return null;
	return { full, preview, contentType };
}

export async function storeAvatarImages(
	bucket: CloudflareEnv["BUCKET"],
	key: string,
	full: File,
	preview: File,
	contentType: AvatarContentType,
): Promise<void> {
	await bucket.put(avatarPreviewKeyFor(key), await preview.arrayBuffer(), {
		httpMetadata: { contentType },
	});
	await bucket.put(key, await full.arrayBuffer(), {
		httpMetadata: { contentType },
	});
}

export async function deleteAvatarImages(bucket: CloudflareEnv["BUCKET"], key: string): Promise<void> {
	await bucket.delete([key, avatarPreviewKeyFor(key)]);
}

export async function getAvatarImageResponse(
	request: Request,
	bucket: CloudflareEnv["BUCKET"],
	key: string,
): Promise<Response> {
	const url = new URL(request.url);
	const imageKey = url.searchParams.get("variant") === "preview" ? avatarPreviewKeyFor(key) : key;
	const object = await bucket.get(imageKey);
	if (!object) return new Response("Not found", { status: 404 });

	const headers = new Headers({
		"Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
		// Uploads change the URL's version. Unversioned URLs refresh within five minutes
		// without an authenticated DB/storage round trip on every component remount.
		"Cache-Control": url.searchParams.has("v")
			? "private, max-age=31536000, immutable"
			: "private, max-age=300",
		// The same URL can resolve to different images after switching accounts.
		Vary: "Cookie, Authorization",
		ETag: object.httpEtag,
	});
	if (request.headers.get("If-None-Match") === object.httpEtag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(object.body, { headers });
}
