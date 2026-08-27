'use client';

import * as React from 'react';
import { toast } from 'sonner';
import type { ApiResponse } from '@/types';

/**
 * The single fetch wrapper every client component uses.
 *
 * Responsibilities:
 *  - attach the CSRF header the API requires on mutations
 *  - unwrap the `{ ok, data }` envelope into a plain value or a thrown error
 *  - surface field-level validation errors so forms can show them inline
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = options;

  const response = await fetch(url, {
    ...rest,
    // Impossible to set from a cross-origin form, so it doubles as CSRF proof.
    headers: {
      'x-requested-with': 'opm-app',
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (a proxy error page, for instance).
  }

  if (!response.ok || !payload || payload.ok === false) {
    const message =
      payload && payload.ok === false ? payload.error : `Request failed (${response.status})`;
    const fields = payload && payload.ok === false ? payload.fields : undefined;

    // A 401 means the session died mid-session; get the user back to login
    // rather than leaving them staring at a broken screen.
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }

    throw new ApiError(message, response.status, fields);
  }

  return payload.data;
}

/** `GET` helper with loading/error state and a manual `refresh()`. */
export function useApi<T>(url: string | null, options?: { initialData?: T }) {
  const [data, setData] = React.useState<T | undefined>(options?.initialData);
  const [loading, setLoading] = React.useState(Boolean(url) && options?.initialData === undefined);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<T>(url));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load, setData };
}

/**
 * Mutation helper. Returns `submitting`, per-field errors, and a `run()` that
 * reports success/failure via toast so callers stay declarative.
 */
export function useMutation<TResult, TInput = unknown>(
  request: (input: TInput) => Promise<TResult>,
) {
  const [submitting, setSubmitting] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const run = React.useCallback(
    async (
      input: TInput,
      handlers?: {
        successMessage?: string;
        onSuccess?: (result: TResult) => void | Promise<void>;
        onError?: (error: ApiError) => void;
      },
    ): Promise<TResult | null> => {
      setSubmitting(true);
      setFieldErrors({});
      try {
        const result = await request(input);
        if (handlers?.successMessage) toast.success(handlers.successMessage);
        await handlers?.onSuccess?.(result);
        return result;
      } catch (error) {
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(error instanceof Error ? error.message : 'Request failed', 0);
        if (apiError.fields) setFieldErrors(apiError.fields);
        // A validation error is already shown inline; a toast would duplicate it.
        if (!apiError.fields) toast.error(apiError.message);
        handlers?.onError?.(apiError);
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [request],
  );

  return { run, submitting, fieldErrors, setFieldErrors };
}
