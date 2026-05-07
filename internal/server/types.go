package server

type StatusResponse struct {
	BaseDir string `json:"baseDir"`
	Auth    bool   `json:"auth"`
}

type PlanRequest struct {
	Files []ClientFile `json:"files"`
	Dirs  []string     `json:"dirs"`
}

type ClientFile struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	ModTimeMs int64  `json:"modTimeMs"`
}

type PlanResponse struct {
	CreateDirs     []string         `json:"createDirs"`
	Uploads        []UploadPlanItem `json:"uploads"`
	HashCandidates []HashCandidate  `json:"hashCandidates"`
	Conflicts      []Conflict       `json:"conflicts"`
	Stats          PlanStats        `json:"stats"`
}

type UploadPlanItem struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	ModTimeMs int64  `json:"modTimeMs"`
	Reason    string `json:"reason"`
}

type HashCandidate struct {
	Path            string `json:"path"`
	Size            int64  `json:"size"`
	ModTimeMs       int64  `json:"modTimeMs"`
	TargetHash      string `json:"targetHash"`
	TargetModTimeMs int64  `json:"targetModTimeMs"`
}

type Conflict struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

type PlanStats struct {
	Files        int   `json:"files"`
	Dirs         int   `json:"dirs"`
	Bytes        int64 `json:"bytes"`
	MissingFiles int   `json:"missingFiles"`
	SizeChanged  int   `json:"sizeChanged"`
	HashChecked  int   `json:"hashChecked"`
	CreateDirs   int   `json:"createDirs"`
	Conflicts    int   `json:"conflicts"`
}

type CreateDirsRequest struct {
	Dirs []string `json:"dirs"`
}

type CreateDirsResponse struct {
	Created   []string   `json:"created"`
	Conflicts []Conflict `json:"conflicts"`
}

type UploadResponse struct {
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	WireSize   int64  `json:"wireSize"`
	Compressed bool   `json:"compressed"`
	SHA256     string `json:"sha256"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}
