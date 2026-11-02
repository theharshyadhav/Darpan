export interface MockOptions {
  apiKey?: string;
  credits?: number;
  runningPolls?: number;
  skinVersions?: string[];
  toneShape?: "map" | "list";
  skinShape?: "output" | "map" | "weird";
}

export interface MockFault {
  at: "upload" | "create" | "task";
  feature?: string;
  status?: number;
  code?: string;
  message?: string;
}

export interface MockYouCam {
  server: import("node:http").Server;
  stats: { uploads: number; creates: Record<string, number>; polls: number; requests: { method?: string; path: string; bytes: number }[]; lastBody: Record<string, Record<string, unknown>> };
  failNext(f: MockFault): void;
  setOptions(o: MockOptions): void;
  reset(): void;
  listen(port?: number, host?: string): Promise<{ origin: string; port: number }>;
  close(): Promise<void>;
}

export function createMock(options?: MockOptions): MockYouCam;
