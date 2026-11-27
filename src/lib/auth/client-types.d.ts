export type AuthFetchOptions = RequestInit & {
	redirectOnUnauthorized?: boolean;
};

export type AuthSessionResponse = {
	ok?: boolean;
	/** A session was issued; it lives only in the HttpOnly cookie. */
	authenticated?: boolean;
	redirect?: string;
	error?: string;
};

export type AuthSessionChangedDetail = {
	authenticated: boolean;
};
