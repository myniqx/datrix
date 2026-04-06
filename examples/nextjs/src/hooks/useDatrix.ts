import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DatrixEntry, DatrixRecord, ParsedQuery } from "@datrix/core";
import { queryToParams } from "@datrix/api";

interface UseDatrixOptions {
	invalidateModels?: string[];
}

type UseDatrixCollectionReturn<
	T extends DatrixEntry = DatrixRecord,
	TCreate = Partial<T>,
	TUpdate = Partial<T>,
> = {
	data: T[];
	isLoading: boolean;
	error: Error | null;
	refetch: () => void;
	create: (payload: TCreate) => Promise<T | undefined>;
	update: (id: number, payload: TUpdate) => Promise<T | undefined>;
	remove: (id: number) => Promise<void>;
};

type UseDatrixSingleReturn<
	T extends DatrixEntry = DatrixRecord,
	TUpdate = Partial<T>,
> = {
	data: T | null;
	isLoading: boolean;
	error: Error | null;
	refetch: () => void;
	update: (payload: TUpdate) => Promise<T | undefined>;
	remove: () => Promise<void>;
};

export function useDatrix<
	T extends DatrixEntry = DatrixRecord,
	TCreate = Partial<T>,
	TUpdate = Partial<T>,
>(
	modelName: string,
	query?: ParsedQuery<T>,
	options?: UseDatrixOptions,
): UseDatrixCollectionReturn<T, TCreate, TUpdate>;
export function useDatrix<
	T extends DatrixEntry = DatrixRecord,
	TCreate = Partial<T>,
	TUpdate = Partial<T>,
>(
	modelName: string,
	id: number,
	query?: ParsedQuery<T>,
	options?: UseDatrixOptions,
): UseDatrixSingleReturn<T, TUpdate>;

export function useDatrix<
	T extends DatrixEntry = DatrixRecord,
	TCreate = Partial<T>,
	TUpdate = Partial<T>,
>(
	modelName: string,
	idOrQuery?: number | ParsedQuery<T>,
	maybeQueryOrOptions?: ParsedQuery<T> | UseDatrixOptions,
	maybeOptions?: UseDatrixOptions,
):
	| UseDatrixCollectionReturn<T, TCreate, TUpdate>
	| UseDatrixSingleReturn<T, TUpdate> {
	const queryClient = useQueryClient();
	const baseUrl = `/api/${modelName.toLowerCase()}s`;

	const isCollection =
		typeof idOrQuery !== "string" && typeof idOrQuery !== "number";
	const id = !isCollection ? idOrQuery : undefined;

	const query = isCollection
		? (idOrQuery as ParsedQuery<T> | undefined)
		: (maybeQueryOrOptions as ParsedQuery<T> | undefined);

	const options = isCollection
		? (maybeQueryOrOptions as UseDatrixOptions | undefined)
		: maybeOptions;

	const invalidateModels = options?.invalidateModels ?? [];

	const queryKey = id
		? [modelName, id, query]
		: [modelName, "collection", query];

	const invalidateAll = () => {
		queryClient.invalidateQueries({ queryKey: [modelName] });
		for (const model of invalidateModels) {
			queryClient.invalidateQueries({ queryKey: [model] });
		}
	};

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
		mutationFn: async (payload: TCreate) => {
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
		onMutate: async (payload) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<T[]>(queryKey);
			if (previous) {
				queryClient.setQueryData<T[]>(queryKey, [
					...previous,
					{
						id: -1,
						createdAt: new Date(),
						updatedAt: new Date(),
						...payload,
					} as unknown as T,
				]);
			}
			return { previous };
		},
		onError: (_err, _payload, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSuccess: () => invalidateAll(),
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			targetId,
			payload,
		}: {
			targetId: number;
			payload: TUpdate;
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
		onMutate: async ({ targetId, payload }) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<T[]>(queryKey);
			if (previous) {
				queryClient.setQueryData<T[]>(
					queryKey,
					previous.map((item) =>
						item.id === targetId ? { ...item, ...payload } : item,
					),
				);
			}
			return { previous };
		},
		onError: (_err, _payload, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSuccess: () => invalidateAll(),
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
		onMutate: async (targetId) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData<T[]>(queryKey);
			if (previous) {
				queryClient.setQueryData<T[]>(
					queryKey,
					previous.filter((item) => item.id !== targetId),
				);
			}
			return { previous };
		},
		onError: (_err, _payload, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSuccess: () => invalidateAll(),
	});

	if (isCollection) {
		return {
			data: (data as T[]) || [],
			isLoading,
			error: error as Error | null,
			refetch,
			create: async (payload: TCreate) => {
				return createMutation.mutateAsync(payload);
			},
			update: async (targetId: number, payload: TUpdate) => {
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
			update: async (payload: TUpdate) => {
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
