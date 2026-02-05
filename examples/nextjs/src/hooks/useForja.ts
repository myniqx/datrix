import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ForjaEntry, ForjaRecord, ParsedQuery } from "forja-types";
import { queryToParams } from "forja-api/serializer";

type UseForjaCollectionReturn<T extends ForjaEntry = ForjaRecord> = {
	data: T[];
	isLoading: boolean;
	error: Error | null;
	refetch: () => void;
	create: (payload: Partial<T>) => Promise<T | undefined>;
	update: (id: number, payload: Partial<T>) => Promise<T | undefined>;
	remove: (id: number) => Promise<void>;
};

type UseForjaSingleReturn<T extends ForjaEntry = ForjaRecord> = {
	data: T | null;
	isLoading: boolean;
	error: Error | null;
	refetch: () => void;
	update: (payload: Partial<T>) => Promise<T | undefined>;
	remove: () => Promise<void>;
};

export function useForja<T extends ForjaEntry = ForjaRecord>(
	modelName: string,
	query?: ParsedQuery<T>,
): UseForjaCollectionReturn<T>;
export function useForja<T extends ForjaEntry = ForjaRecord>(
	modelName: string,
	id: number,
	query?: ParsedQuery<T>,
): UseForjaSingleReturn<T>;

export function useForja<T extends ForjaEntry = ForjaRecord>(
	modelName: string,
	idOrQuery?: number | ParsedQuery<T>,
	maybeQuery?: ParsedQuery<T>,
): UseForjaCollectionReturn<T> | UseForjaSingleReturn<T> {
	const queryClient = useQueryClient();
	const baseUrl = `/api/${modelName.toLowerCase()}s`;

	const isCollection =
		typeof idOrQuery !== "string" && typeof idOrQuery !== "number";
	const id = !isCollection ? idOrQuery : undefined;
	const query = isCollection ? idOrQuery : maybeQuery;

	const queryKey = id
		? [modelName, id, query]
		: [modelName, "collection", query];

	const { data, isLoading, error, refetch } = useQuery<T[] | T | null, Error>({
		queryKey,
		queryFn: async () => {
			const params = queryToParams(query);

			const url = id ? `${baseUrl}/${id}${params}` : `${baseUrl}?${params}`;

			const response = await fetch(url);
			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error?.message || "Request failed");
			}

			return result.data;
		},
		enabled: true,
	});

	const createMutation = useMutation({
		mutationFn: async (payload: Partial<T>) => {
			const response = await fetch(baseUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error?.message || "Create failed");
			}
			return result.data as T;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: [modelName] });
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			targetId,
			payload,
		}: {
			targetId: number;
			payload: Partial<T>;
		}) => {
			const response = await fetch(`${baseUrl}/${targetId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error?.message || "Update failed");
			}
			return result.data as T;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: [modelName] });
		},
	});

	const removeMutation = useMutation({
		mutationFn: async (targetId: number) => {
			const response = await fetch(`${baseUrl}/${targetId}`, {
				method: "DELETE",
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error?.message || "Delete failed");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: [modelName] });
		},
	});

	if (isCollection) {
		return {
			data: (data as T[]) || [],
			isLoading,
			error: error as Error | null,
			refetch,
			create: async (payload: Partial<T>) => {
				return createMutation.mutateAsync(payload);
			},
			update: async (targetId: number, payload: Partial<T>) => {
				return updateMutation.mutateAsync({ targetId, payload });
			},
			remove: async (targetId: number) => {
				await removeMutation.mutateAsync(targetId);
			},
		};
	} else {
		return {
			data: (data as T) || null,
			isLoading,
			error: error as Error | null,
			refetch,
			update: async (payload: Partial<T>) => {
				if (!id) throw new Error("No ID provided for update");
				return updateMutation.mutateAsync({ targetId: id, payload });
			},
			remove: async () => {
				if (!id) throw new Error("No ID provided for delete");
				await removeMutation.mutateAsync(id);
			},
		};
	}
}
