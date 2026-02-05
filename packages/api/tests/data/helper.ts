import { queryToParams } from "forja-api";
import { ForjaEntry, ParsedQuery } from "forja-types";

export function createRequest(
	url: string,
	options: {
		method?: string;
		body?: Record<string, unknown>;
		token?: string;
		cookie?: string;
	} = {},
	params: ParsedQuery<ForjaEntry> = {},
): Request {
	const { method = "GET", body, token, cookie } = options;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	if (cookie) {
		headers["Cookie"] = cookie;
	}

	if (url.startsWith("/")) {
		url = `http://localhost:3000${url}`;
	}

	const extParams = queryToParams(params);
	if (extParams) {
		url += `?${extParams}`;
	}

	return new Request(url, {
		method,
		headers,
		...(body && { body: JSON.stringify(body) }),
	});
}
