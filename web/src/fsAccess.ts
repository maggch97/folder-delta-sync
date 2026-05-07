import type { FolderSnapshot, LocalFile } from "./types";

export async function pickFolder(): Promise<FolderSnapshot> {
  return pickWithFileInput();
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

