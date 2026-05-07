import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Caption1,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Slider,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  Tooltip,
  makeStyles,
  tokens
} from "@fluentui/react-components";
import {
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  CloudArrowUpRegular,
  ErrorCircleRegular,
  FolderOpenRegular
} from "@fluentui/react-icons";
import { bootstrapToken, canCompressUploads, createDirs, createPlan, getStatus, saveToken, uploadFile } from "./api";
import { pickFolder } from "./fsAccess";
import { sha256File } from "./hash";
import type { FolderSnapshot, LogItem, Phase, StatusResponse, UploadTask } from "./types";
import { formatBytes, reasonText, runPool } from "./utils";

type Metrics = {
  folder: string;
  files: number;
  bytes: number;
  dirs: number;
  hashFiles: number;
  hashedFiles: number;
  hashedBytes: number;
  uploadFiles: number;
  uploadBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
  uploadedWireBytes: number;
  createdDirs: number;
};

const emptyMetrics: Metrics = {
  folder: "",
  files: 0,
  bytes: 0,
  dirs: 0,
  hashFiles: 0,
  hashedFiles: 0,
  hashedBytes: 0,
  uploadFiles: 0,
  uploadBytes: 0,
  uploadedFiles: 0,
  uploadedBytes: 0,
  uploadedWireBytes: 0,
  createdDirs: 0
};

const phaseText: Record<Phase, string> = {
  idle: "待选择",
  scanning: "扫描中",
  planning: "比较中",
  hashing: "校验中",
  creating: "建目录",
  uploading: "上传中",
  done: "完成",
  error: "失败"
};

const useStyles = makeStyles({
  root: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column"
  },
  header: {
    minHeight: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "0 24px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "flex-end"
  },
  main: {
    width: "100%",
    maxWidth: "1180px",
    margin: "0 auto",
    padding: "22px 24px 28px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "18px"
  },
  statusBand: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "16px",
    display: "grid",
    gap: "14px"
  },
  statusLine: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap"
  },
  target: {
    display: "grid",
    gap: "3px",
    minWidth: 0
  },
  pathText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "76vw"
  },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
    gap: "10px",
    "@media (max-width: 900px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
    }
  },
  metric: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    padding: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: "78px",
    display: "grid",
    alignContent: "center",
    gap: "4px"
  },
  metricValue: {
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: 600
  },
  workArea: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: "18px",
    "@media (max-width: 980px)": {
      gridTemplateColumns: "minmax(0, 1fr)"
    }
  },
  panel: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "8px",
    minHeight: "240px",
    overflow: "hidden"
  },
  panelHeader: {
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 14px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
  },
  panelBody: {
    padding: "14px"
  },
  settings: {
    display: "grid",
    gap: "16px"
  },
  authRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "8px"
  },
  empty: {
    height: "190px",
    display: "grid",
    placeItems: "center",
    color: tokens.colorNeutralForeground3
  },
  logLevel: {
    width: "64px"
  }
});

export function App() {
  const styles = useStyles();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenText, setTokenText] = useState(() => bootstrapToken());
  const [uploadConcurrency, setUploadConcurrency] = useState(3);
  const compressionSupported = useMemo(() => canCompressUploads(), []);
  const [compressUploads, setCompressUploads] = useState(() => canCompressUploads());
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState("");
  const logID = useRef(0);

  const addLog = useCallback((level: LogItem["level"], text: string) => {
    setLogs((prev) => [{ id: ++logID.current, level, text }, ...prev].slice(0, 80));
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getStatus();
      setStatus(next);
      setNeedsToken(false);
      setError("");
    } catch (err) {
      const statusCode = (err as Error & { status?: number }).status;
      if (statusCode === 401) {
        setNeedsToken(true);
        setStatus(null);
        setError("需要 token");
        return;
      }
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const progress = useMemo(() => {
    if (phase === "hashing" && metrics.hashFiles > 0) {
      return metrics.hashedFiles / metrics.hashFiles;
    }
    if (phase === "uploading" && metrics.uploadBytes > 0) {
      return metrics.uploadedBytes / metrics.uploadBytes;
    }
    if (phase === "done") {
      return 1;
    }
    if (busy) {
      return undefined;
    }
    return 0;
  }, [busy, metrics.hashFiles, metrics.hashedFiles, metrics.uploadBytes, metrics.uploadedBytes, phase]);

  const canChoose = !busy && !!status;

  const applyToken = useCallback(async () => {
    saveToken(tokenText);
    await refreshStatus();
  }, [refreshStatus, tokenText]);

  const startSync = useCallback(async () => {
    if (!status) {
      return;
    }

    setBusy(true);
    setPhase("scanning");
    setError("");
    setLogs([]);
    setMetrics(emptyMetrics);

    try {
      const snapshot = await pickFolder();
      addLog("info", `${snapshot.name}: ${snapshot.files.length} 个文件，${formatBytes(snapshot.bytes)}`);
      setMetrics({
        ...emptyMetrics,
        folder: snapshot.name,
        files: snapshot.files.length,
        bytes: snapshot.bytes,
        dirs: snapshot.dirs.length
      });

      setPhase("planning");
      const plan = await createPlan({
        files: snapshot.files.map((file) => ({
          path: file.path,
          size: file.size,
          modTimeMs: file.modTimeMs
        })),
        dirs: snapshot.dirs
      });

      if (plan.conflicts.length > 0) {
        const first = plan.conflicts[0];
        throw new Error(`${first.path}: ${first.reason}`);
      }

      const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
      const uploadTasks = new Map<string, UploadTask>();
      for (const item of plan.uploads) {
        const local = byPath.get(item.path);
        if (!local) {
          continue;
        }
        uploadTasks.set(item.path, {
          path: item.path,
          file: local.file,
          size: local.size,
          modTimeMs: local.modTimeMs,
          reason: item.reason
        });
      }

      setMetrics((prev) => ({
        ...prev,
        hashFiles: plan.hashCandidates.length,
        uploadFiles: uploadTasks.size,
        uploadBytes: sumUploadBytes(uploadTasks)
      }));

      if (plan.hashCandidates.length > 0) {
        setPhase("hashing");
        await runPool(plan.hashCandidates, 2, async (candidate) => {
          const local = byPath.get(candidate.path);
          if (!local) {
            return;
          }
          const sum = await sha256File(local.file, (bytes) => {
            setMetrics((prev) => ({ ...prev, hashedBytes: prev.hashedBytes + bytes }));
          });
          if (sum !== candidate.targetHash) {
            uploadTasks.set(candidate.path, {
              path: candidate.path,
              file: local.file,
              size: local.size,
              modTimeMs: local.modTimeMs,
              reason: "hash",
              sha256: sum
            });
          }
          setMetrics((prev) => ({ ...prev, hashedFiles: prev.hashedFiles + 1 }));
        });
      }

      const finalUploads = Array.from(uploadTasks.values()).sort((a, b) => a.path.localeCompare(b.path));
      setMetrics((prev) => ({
        ...prev,
        uploadFiles: finalUploads.length,
        uploadBytes: finalUploads.reduce((sum, item) => sum + item.size, 0)
      }));

      if (plan.createDirs.length > 0) {
        setPhase("creating");
        const created = await createDirs(plan.createDirs);
        if (created.conflicts.length > 0) {
          const first = created.conflicts[0];
          throw new Error(`${first.path}: ${first.reason}`);
        }
        setMetrics((prev) => ({ ...prev, createdDirs: created.created.length }));
      }

      if (finalUploads.length > 0) {
        setPhase("uploading");
        await runPool(finalUploads, uploadConcurrency, async (task) => {
          const result = await uploadFile({
            path: task.path,
            file: task.file,
            size: task.size,
            modTimeMs: task.modTimeMs,
            sha256: task.sha256,
            compress: compressUploads
          });
          setMetrics((prev) => ({
            ...prev,
            uploadedFiles: prev.uploadedFiles + 1,
            uploadedBytes: prev.uploadedBytes + task.size,
            uploadedWireBytes: prev.uploadedWireBytes + (result.wireSize || task.size)
          }));
          const saved =
            result.compressed && result.wireSize > 0
              ? ` (${formatBytes(result.wireSize)} / ${formatBytes(task.size)})`
              : "";
          addLog("success", `${reasonText(task.reason)}: ${task.path}${saved}`);
        });
      }

      setPhase("done");
      addLog("success", `完成: 上传 ${finalUploads.length} 个文件`);
    } catch (err) {
      setPhase("error");
      const message = (err as Error).message;
      setError(message);
      addLog("error", message);
    } finally {
      setBusy(false);
    }
  }, [addLog, compressUploads, status, uploadConcurrency]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.brand}>
          {phase === "uploading" || phase === "hashing" || phase === "planning" ? (
            <Spinner size="tiny" />
          ) : phase === "done" ? (
            <CheckmarkCircleRegular />
          ) : phase === "error" ? (
            <ErrorCircleRegular />
          ) : (
            <CloudArrowUpRegular />
          )}
          <Title2>Folder Delta Sync</Title2>
          <Badge color={phase === "done" ? "success" : phase === "error" ? "danger" : "brand"}>
            {phaseText[phase]}
          </Badge>
        </div>
        <div className={styles.actions}>
          <Tooltip content="刷新连接状态" relationship="label">
            <Button icon={<ArrowSyncRegular />} onClick={refreshStatus} disabled={busy} />
          </Tooltip>
          <Button appearance="primary" icon={<FolderOpenRegular />} disabled={!canChoose} onClick={startSync}>
            选择文件夹
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        {error && (
          <MessageBar intent={phase === "error" || needsToken ? "error" : "warning"}>
            <MessageBarBody>
              <MessageBarTitle>{needsToken ? "认证" : "状态"}</MessageBarTitle>
              {error}
            </MessageBarBody>
          </MessageBar>
        )}

        <section className={styles.statusBand}>
          <div className={styles.statusLine}>
            <div className={styles.target}>
              <Caption1>目标目录</Caption1>
              <Text className={styles.pathText} weight="semibold">
                {status?.baseDir ?? "未连接"}
              </Text>
            </div>
            <Badge appearance="outline" color={status ? "success" : "subtle"}>
              HTTP
            </Badge>
          </div>
          <ProgressBar value={progress} />
        </section>

        <section className={styles.metrics}>
          <Metric label="源文件" value={metrics.files ? metrics.files.toLocaleString() : "-"} />
          <Metric label="源大小" value={metrics.bytes ? formatBytes(metrics.bytes) : "-"} />
          <Metric label="哈希校验" value={`${metrics.hashedFiles}/${metrics.hashFiles}`} />
          <Metric label="待上传" value={metrics.uploadFiles ? metrics.uploadFiles.toLocaleString() : "0"} />
          <Metric label="已上传" value={metrics.uploadedBytes ? formatBytes(metrics.uploadedBytes) : "0 B"} />
          <Metric label="网络传输" value={metrics.uploadedWireBytes ? formatBytes(metrics.uploadedWireBytes) : "0 B"} />
        </section>

        <section className={styles.workArea}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <Text weight="semibold">传输记录</Text>
              <Caption1>
                {metrics.folder ? `${metrics.folder} · ${metrics.createdDirs} 个目录` : "无任务"}
              </Caption1>
            </div>
            {logs.length === 0 ? (
              <div className={styles.empty}>暂无记录</div>
            ) : (
              <Table size="small" aria-label="传输记录">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className={styles.logLevel}>状态</TableHeaderCell>
                    <TableHeaderCell>文件</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className={styles.logLevel}>{logLevelText(item.level)}</TableCell>
                      <TableCell>{item.text}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <aside className={styles.panel}>
            <div className={styles.panelHeader}>
              <Text weight="semibold">设置</Text>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.settings}>
                <Field label={`上传并发 ${uploadConcurrency}`}>
                  <Slider
                    min={1}
                    max={8}
                    step={1}
                    value={uploadConcurrency}
                    onChange={(_, data) => setUploadConcurrency(data.value)}
                    disabled={busy}
                  />
                </Field>

                <Divider />

                <Field label="gzip 压缩">
                  <Switch
                    checked={compressUploads && compressionSupported}
                    disabled={busy || !compressionSupported}
                    label={compressionSupported ? "上传差异文件时压缩" : "当前浏览器不支持"}
                    onChange={(_, data) => setCompressUploads(data.checked)}
                  />
                </Field>

                <Divider />

                <Field label="Token">
                  <div className={styles.authRow}>
                    <Input
                      type="password"
                      value={tokenText}
                      onChange={(_, data) => setTokenText(data.value)}
                      disabled={busy}
                    />
                    <Button onClick={applyToken} disabled={busy}>
                      应用
                    </Button>
                  </div>
                </Field>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <div className={styles.metric}>
      <Caption1>{props.label}</Caption1>
      <div className={styles.metricValue}>{props.value}</div>
    </div>
  );
}

function logLevelText(level: LogItem["level"]): string {
  switch (level) {
    case "success":
      return "成功";
    case "error":
      return "错误";
    default:
      return "信息";
  }
}

function sumUploadBytes(tasks: Map<string, UploadTask>): number {
  let total = 0;
  for (const task of tasks.values()) {
    total += task.size;
  }
  return total;
}
