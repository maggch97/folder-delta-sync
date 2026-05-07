import type {
  CreateDirsResponse,
  PlanRequest,
  PlanResponse,
  StatusResponse,
  UploadResponse
} from "./types";

const tokenStorageKey = "folder-delta-sync-token";

export function bootstrapToken(): string {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(tokenStorageKey, token);
    params.delete("token");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }
  return sessionStorage.getItem(tokenStorageKey) ?? "";
}

export function saveToken(token: string): void {
  const value = token.trim();
  if (value) {
    sessionStorage.setItem(tokenStorageKey, value);
  } else {
    sessionStorage.removeItem(tokenStorageKey);
  }
}

export async function getStatus(): Promise<StatusResponse> {
  return apiFetch<StatusResponse>("/api/status");
}

export async function createPlan(req: PlanRequest): Promise<PlanResponse> {
  return apiFetch<PlanResponse>("/api/plan", {
    method: "POST",
    body: JSON.stringify(req)
  });
}

export async function createDirs(dirs: string[]): Promise<CreateDirsResponse> {
  return apiFetch<CreateDirsResponse>("/api/dirs", {
    method: "POST",
    body: JSON.stringify({ dirs })
  });
}

export async function uploadFile(options: {
  path: string;
  file: File;
  size: number;
  modTimeMs: number;
  sha256?: string;
  compress?: boolean;
}): Promise<UploadResponse> {
  const params = new URLSearchParams({
    path: options.path,
    size: String(options.size),
    mtimeMs: String(options.modTimeMs)
  });
  if (options.sha256) {
    params.set("sha256", options.sha256);
  }
  const headers = new Headers({
    "Content-Type": "application/octet-stream"
  });
  let body: BodyInit = options.file;
  let streaming = false;
  if (options.compress && canCompressUploads() && options.file.size > 0) {
    const ctor = (window as unknown as { CompressionStream: new (format: "gzip") => CompressionStream })
      .CompressionStream;
    body = options.file.stream().pipeThrough(new ctor("gzip")) as unknown as BodyInit;
    headers.set("Content-Encoding", "gzip");
    streaming = true;
  }

  return apiFetch<UploadResponse>(`/api/file?${params.toString()}`, {
    method: "PUT",
    headers,
    body,
    ...(streaming ? { duplex: "half" } : {})
  } as RequestInit & { duplex?: "half" });
}

export function canCompressUploads(): boolean {
  return "CompressionStream" in window && typeof File.prototype.stream === "function";
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const token = sessionStorage.getItem(tokenStorageKey);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Keep the HTTP status text.
    }
    const err = new Error(message);
    Object.assign(err, { status: response.status });
    throw err;
  }
  return (await response.json()) as T;
}
