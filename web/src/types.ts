export type Phase =
  | "idle"
  | "scanning"
  | "planning"
  | "hashing"
  | "creating"
  | "uploading"
  | "done"
  | "error";

export type LocalFile = {
  path: string;
  file: File;
  size: number;
  modTimeMs: number;
};

export type FolderSnapshot = {
  name: string;
  files: LocalFile[];
  dirs: string[];
  bytes: number;
  picker: "showDirectoryPicker" | "webkitdirectory";
};

export type StatusResponse = {
  baseDir: string;
  auth: boolean;
  tls: boolean;
};

export type PlanRequest = {
  files: Array<{
    path: string;
    size: number;
    modTimeMs: number;
  }>;
  dirs: string[];
};

export type PlanResponse = {
  createDirs: string[];
  uploads: UploadPlanItem[];
  hashCandidates: HashCandidate[];
  conflicts: Conflict[];
  stats: {
    files: number;
    dirs: number;
    bytes: number;
    missingFiles: number;
    sizeChanged: number;
    hashChecked: number;
    createDirs: number;
    conflicts: number;
  };
};

export type UploadPlanItem = {
  path: string;
  size: number;
  modTimeMs: number;
  reason: "missing" | "size" | string;
};

export type HashCandidate = {
  path: string;
  size: number;
  modTimeMs: number;
  targetHash: string;
  targetModTimeMs: number;
};

export type Conflict = {
  path: string;
  reason: string;
};

export type CreateDirsResponse = {
  created: string[];
  conflicts: Conflict[];
};

export type UploadResponse = {
  path: string;
  size: number;
  wireSize: number;
  compressed: boolean;
  sha256: string;
};

export type UploadTask = {
  path: string;
  file: File;
  size: number;
  modTimeMs: number;
  reason: string;
  sha256?: string;
};

export type LogItem = {
  id: number;
  level: "info" | "success" | "error";
  text: string;
};
