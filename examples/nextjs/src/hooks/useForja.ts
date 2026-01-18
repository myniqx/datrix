import { useState, useCallback } from "react";
import { serializeQuery } from "forja-api/serializer";

export interface ForjaQuery {
  where?: Record<string, any>;
  populate?: Record<string, any>;
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
}

export function useForja<T = any>(modelName: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `/api/${modelName.toLowerCase()}s`; // Simplified forja-api convention

  const fetchAll = useCallback(
    async (query?: ForjaQuery) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) {
          const serialized = serializeQuery(query as any);
          Object.entries(serialized).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              value.forEach((v) => params.append(key, v));
            } else if (value !== undefined) {
              params.append(key, value);
            }
          });
        }
        const response = await fetch(`${baseUrl}?${params.toString()}`);
        const result = await response.json();

        setData(result.data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl],
  );

  const create = useCallback(
    async (payload: any) => {
      setLoading(true);
      try {
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (result.data) {
          await fetchAll(); // Refresh list
          return result.data;
        } else {
          setError(result.error?.message || "Create failed");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, fetchAll],
  );

  const update = useCallback(
    async (id: string, payload: any) => {
      setLoading(true);
      try {
        const response = await fetch(`${baseUrl}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (result.data) {
          await fetchAll();
          return result.data;
        } else {
          setError(result.error?.message || "Update failed");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, fetchAll],
  );

  const remove = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const response = await fetch(`${baseUrl}/${id}`, {
          method: "DELETE",
        });
        const result = await response.json();
        if (result.data) {
          await fetchAll();
        } else {
          setError(result.error?.message || "Delete failed");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, fetchAll],
  );

  return { data, loading, error, fetchAll, create, update, remove };
}
