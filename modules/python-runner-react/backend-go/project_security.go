package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *projectService) projectScan(ctx context.Context, p project, refresh bool) (securityScan, error) {
	s.scans.Lock()
	defer s.scans.Unlock()
	if !refresh {
		scan, err := s.loadProjectScan(ctx, p)
		if !errors.Is(err, pgx.ErrNoRows) {
			return scan, err
		}
	}
	findings, err := projectFindings(p)
	if err != nil {
		return securityScan{}, err
	}
	risk, summary := summarizeFindings(findings)
	now := time.Now().UTC()
	id := hashPrefix(p.ID+":"+p.SourceHash, 12) + "-" + strconv.FormatInt(now.UnixMilli(), 36) + "-" + hashPrefix(newID("scan"), 8)
	for i := range findings {
		findings[i].ID = hashPrefix(id+":"+strconv.Itoa(i)+":"+findings[i].ID, 24)
	}
	scan := securityScan{
		RunnerMode: "local_venv", SecurityMode: "guarded", ID: id, RiskLevel: risk, Summary: summary,
		Findings: findings, ScannedAt: formatTime(now), Message: projectRiskMessage(risk),
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO pr_security_scans
			(id,project_id,source_hash,risk_level,summary,message,scanned_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			id, p.ID, p.SourceHash, risk, summary, scan.Message, now); err != nil {
			return err
		}
		rows := make([][]any, 0, len(findings))
		for _, f := range findings {
			rows = append(rows, []any{f.ID, id, f.Level, f.Category, f.File, f.Line, f.Message, f.Suggestion, nullString(f.Token), nullString(f.Content)})
		}
		if len(rows) == 0 {
			return nil
		}
		_, err := tx.CopyFrom(ctx, pgx.Identifier{"pr_security_findings"},
			[]string{"id", "scan_id", "level", "category", "file", "line", "message", "suggestion", "token", "content"}, pgx.CopyFromRows(rows))
		return err
	})
	return scan, err
}

func nullString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *projectService) loadProjectScan(ctx context.Context, p project) (securityScan, error) {
	scan := securityScan{RunnerMode: "local_venv", SecurityMode: "guarded", Findings: []securityFinding{}}
	var scanned time.Time
	err := s.db.QueryRow(ctx, `SELECT id,risk_level,summary,message,scanned_at FROM pr_security_scans
		WHERE project_id=$1 AND source_hash=$2 ORDER BY scanned_at DESC LIMIT 1`, p.ID, p.SourceHash).Scan(
		&scan.ID, &scan.RiskLevel, &scan.Summary, &scan.Message, &scanned)
	if err != nil {
		return scan, err
	}
	scan.ScannedAt = formatTime(scanned)
	rows, err := s.db.Query(ctx, `SELECT id,level,category,file,line,message,suggestion,COALESCE(token,''),COALESCE(content,'')
		FROM pr_security_findings WHERE scan_id=$1 ORDER BY file,line NULLS LAST`, scan.ID)
	if err != nil {
		return scan, err
	}
	scan.Findings, err = pgx.AppendRows(scan.Findings, rows, func(row pgx.CollectableRow) (securityFinding, error) {
		var f securityFinding
		err := row.Scan(&f.ID, &f.Level, &f.Category, &f.File, &f.Line, &f.Message, &f.Suggestion, &f.Token, &f.Content)
		return f, err
	})
	return scan, err
}

var secretFile = regexp.MustCompile(`(?i)(?:^\.(?:env|env\.local|env\.production)$|^(?:credentials\.json|token\.json|secret\.json|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$)`)

var dependencyRules = []struct{ token, level, suggestion string }{
	{"file://", "blocked", "禁止从本地文件 URL 安装依赖。"},
	{"../", "blocked", "禁止 requirements.txt 引用项目外路径。"},
	{"-e", "high", "可编辑安装会执行外部构建逻辑，请确认来源可信。"},
	{"--editable", "high", "可编辑安装会执行外部构建逻辑，请确认来源可信。"},
	{"git+", "high", "Git 依赖会从远程仓库拉取代码，请确认来源可信。"},
	{"http://", "high", "明文 HTTP 依赖源存在被篡改风险。"},
	{"--index-url", "high", "自定义依赖源会改变安装来源，请确认可信。"},
	{"--extra-index-url", "high", "额外依赖源会改变安装来源，请确认可信。"},
	{"--trusted-host", "medium", "trusted-host 会降低 pip TLS 校验要求。"},
	{"--pre", "medium", "预发布版本稳定性和安全性需要额外确认。"},
	{"https://", "medium", "直接 URL 依赖需要确认来源可信。"},
}

func projectFindings(p project) ([]securityFinding, error) {
	root, err := os.OpenRoot(p.Root)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	findings := []securityFinding{}
	var visit func([]projectFile)
	visit = func(nodes []projectFile) {
		for _, node := range nodes {
			if node.Type == "file" && secretFile.MatchString(path.Base(node.Path)) {
				findings = append(findings, makeFinding("high", "sensitive_file", node.Path, nil,
					"项目中包含疑似敏感文件。", "请移除密钥、令牌或生产环境配置。", "", ""))
			} else if node.Children != nil {
				visit(*node.Children)
			}
		}
	}
	visit(p.Metadata.Tree)
	for _, name := range p.Metadata.PythonFiles[:min(500, len(p.Metadata.PythonFiles))] {
		content, err := readProjectScanFile(root, name, 1<<20)
		if err != nil {
			return nil, err
		}
		if len(content) > 1<<20 {
			findings = append(findings, makeFinding("medium", "source", name, nil,
				"Python 文件超过 1 MB，已跳过深度扫描。", "请人工确认该文件来源可信。", "", ""))
			continue
		}
		findings = append(findings, scanSource(content, name)...)
	}
	for _, name := range p.Metadata.DependencyFiles {
		if !strings.EqualFold(path.Base(name), "requirements.txt") {
			continue
		}
		content, err := readProjectScanFile(root, name, maxProjectFileBytes)
		if err != nil {
			return nil, err
		}
		if len(content) > maxProjectFileBytes {
			return nil, badRequest("依赖文件超过大小限制。")
		}
		for i, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			lower := strings.ToLower(line)
			if lower == "" || strings.HasPrefix(lower, "#") {
				continue
			}
			for _, rule := range dependencyRules {
				if strings.Contains(lower, rule.token) {
					number := i + 1
					findings = append(findings, makeFinding(rule.level, "requirements", name, &number,
						"requirements.txt 包含风险依赖声明："+rule.token, rule.suggestion, rule.token, line))
					break
				}
			}
		}
	}
	return findings, nil
}

func readProjectScanFile(root *os.Root, name string, limit int64) (string, error) {
	name, err := projectRelative(name)
	if err != nil {
		return "", err
	}
	file, err := root.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	return strings.ReplaceAll(strings.ToValidUTF8(string(data), "�"), "\x00", "�"), err
}
