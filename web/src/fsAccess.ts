import type { FolderSnapshot, LocalFile } from "./types";

type BrowserFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

type BrowserDirectoryHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, BrowserFileHandle | BrowserDirectoryHandle]>;
};

export async function pickFolder(): Promise<FolderSnapshot> {
  if ("showDirectoryPicker" in window && window.isSecureContext) {
    return pickWithDirectoryHandle();
  }
  return pickWithFileInput();
}

async function pickWithDirectoryHandle(): Promise<FolderSnapshot> {
  const picker = (window as unknown as {
    showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<BrowserDirectoryHandle>;
  }).showDirectoryPicker;
  const root = await picker({ mode: "read" });
  const files: LocalFile[] = [];
  const dirs: string[] = [];

  await walkDirectory(root, "", files, dirs);
  files.sort(comparePath);
  dirs.sort();

  return {
    name: root.name,
    files,
    dirs,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    picker: "showDirectoryPicker"
  };
}

async function walkDirectory(
  dir: BrowserDirectoryHandle,
  prefix: string,
  files: LocalFile[],
  dirs: string[]
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const relPath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      dirs.push(relPath);
      await walkDirectory(handle, relPath, files, dirs);
      continue;
    }
    const file = await handle.getFile();
    files.push({
      path: relPath,
      file,
      size: file.size,
      modTimeMs: file.lastModified
    });
  }
}

async function pickWithFileInput(): Promise<FolderSnapshot> {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.setAttribute("webkitdirectory", "");
  input.style.display = "none";
  document.body.appendChild(input);

  try {
    const files = await new Promise<FileList>((resolve, reject) => {
      input.addEventListener("change", () => {
        if (!input.files || input.files.length === 0) {
          reject(new Error("未选择文件夹"));
          return;
        }
        resolve(input.files);
      });
      input.click();
    });

    const localFiles = Array.from(files).map((file) => {
      const rawPath = getWebkitRelativePath(file);
      return {
        path: stripRoot(rawPath),
        file,
        size: file.size,
        modTimeMs: file.lastModified
      };
    });
    localFiles.sort(comparePath);
    const dirs = deriveDirs(localFiles.map((file) => file.path));
    const rootName = getRootName(getWebkitRelativePath(localFiles[0].file));

    return {
      name: rootName,
      files: localFiles,
      dirs,
      bytes: localFiles.reduce((sum, item) => sum + item.size, 0),
      picker: "webkitdirectory"
    };
  } finally {
    input.remove();
  }
}

function getWebkitRelativePath(file: File): string {
  const value = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return value && value.length > 0 ? value.replaceAll("\\", "/") : file.name;
}

function stripRoot(rawPath: string): string {
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.length > 1) {
    parts.shift();
  }
  return parts.join("/");
}

function getRootName(rawPath: string): string {
  const parts = rawPath.split("/").filter(Boolean);
  return parts[0] ?? "folder";
}

function deriveDirs(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const filePath of paths) {
    const parts = filePath.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      dirs.add(current);
    }
  }
  return Array.from(dirs).sort();
}

function comparePath(a: LocalFile, b: LocalFile): number {
  return a.path.localeCompare(b.path);
}

