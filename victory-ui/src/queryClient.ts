import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        // 429 is retried inside the API client; 4xx are final; network blips get one more try.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
