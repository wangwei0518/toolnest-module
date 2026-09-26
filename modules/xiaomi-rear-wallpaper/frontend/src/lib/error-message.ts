export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === "string") return response.data.message;
  }
  return error instanceof Error ? error.message : fallback;
}
