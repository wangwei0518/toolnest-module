package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type securityFinding struct {
	ID         string `json:"id"`
	Level      string `json:"level"`
	Category   string `json:"category"`
	File       string `json:"file"`
	Line       *int   `json:"line"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
	Token      string `json:"token,omitempty"`
	Content    string `json:"content,omitempty"`
}

type securityScan struct {
	RunnerMode   string            `json:"runner_mode"`
	SecurityMode string            `json:"security_mode"`
	ID           string            `json:"scan_id"`
	RiskLevel    string            `json:"risk_level"`
	Summary      map[string]int    `json:"summary"`
	Findings     []securityFinding `json:"findings"`
	ScannedAt    string            `json:"scanned_at"`
	Message      string            `json:"message"`
}

type securityConfirmation struct {
	ID        string `json:"scan_id"`
	Confirmed bool   `json:"risk_confirmed"`
}

type securityError struct {
	scan   securityScan
	action string
}

func (err *securityError) Error() string {
	return err.action + "前需要确认当前安全扫描风险。"
}

func (scan securityScan) require(confirmation securityConfirmation, action string) error {
	if scan.RiskLevel == "blocked" ||
		((scan.RiskLevel == "medium" || scan.RiskLevel == "high") && (!confirmation.Confirmed || confirmation.ID != scan.ID)) {
		return &securityError{scan: scan, action: action}
	}
	return nil
}

type sourceRule struct {
	pattern                     *regexp.Regexp
	level, category, suggestion string
}

var sourceRules = []sourceRule{
	{regexp.MustCompile(`\bos\.remove\s*\(`), "high", "filesystem", "会删除文件，请确认脚本只操作项目目录。"},
	{regexp.MustCompile(`\bos\.rmdir\s*\(`), "high", "filesystem", "会删除目录，请确认脚本只操作项目目录。"},
	{regexp.MustCompile(`\bshutil\.rmtree\s*\(`), "high", "filesystem", "会递归删除目录，请确认目标路径。"},
	{regexp.MustCompile(`\bsubprocess\b`), "high", "subprocess", "会启动外部进程，请确认命令来源和参数可信。"},
	{regexp.MustCompile(`\bos\.system\s*\(`), "high", "subprocess", "会通过系统命令执行，请确认命令来源可信。"},
	{regexp.MustCompile(`\bsocket\b`), "medium", "network", "会访问网络或监听端口，请确认目标可信。"},
	{regexp.MustCompile(`\b(requests|urllib|httpx|aiohttp)\b`), "medium", "network", "会访问网络，请确认目标可信。"},
	{regexp.MustCompile(`\b(paramiko|ftplib|smtplib)\b`), "high", "network", "会建立远程连接，请确认凭据和目标可信。"},
	{regexp.MustCompile(`\beval\s*\(`), "high", "dynamic", "会动态执行表达式，请确认输入不可被外部控制。"},
	{regexp.MustCompile(`\bexec\s*\(`), "high", "dynamic", "会动态执行代码，请确认来源可信。"},
	{regexp.MustCompile(`\b(__import__|importlib\.import_module)\s*\(`), "medium", "dynamic", "会动态导入模块，请确认模块来源可信。"},
	{regexp.MustCompile(`\bos\.(environ|getenv)\b`), "medium", "environment", "会读取环境变量，运行环境只注入受控变量。"},
	{regexp.MustCompile(`\b(ctypes|pickle\.loads?|marshal)\b`), "high", "serialization", "可能执行底层调用或不安全反序列化。"},
	{regexp.MustCompile(`(?i)\b(schtasks|systemd|crontab|startup)\b`), "high", "persistence", "可能修改系统计划任务或自启动配置。"},
}

func scanSource(code, file string) []securityFinding {
	findings := []securityFinding{}
	for i, line := range strings.Split(strings.ReplaceAll(code, "\r\n", "\n"), "\n") {
		for _, rule := range sourceRules {
			if rule.pattern.MatchString(line) {
				lineNumber := i + 1
				description := []rune(strings.TrimSpace(line))
				message := "发现潜在风险代码：" + string(description[:min(120, len(description))])
				findings = append(findings, makeFinding(rule.level, rule.category, file, &lineNumber, message, rule.suggestion, "", ""))
			}
		}
	}
	return findings
}

func makeFinding(level, category, file string, line *int, message, suggestion, token, content string) securityFinding {
	lineString := "null"
	if line != nil {
		lineString = strconv.Itoa(*line)
	}
	id := hashPrefix(strings.Join([]string{level, category, file, lineString, message, suggestion, token}, ":"), 12)
	return securityFinding{id, level, category, file, line, message, suggestion, token, content}
}

func hashPrefix(value string, length int) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:length]
}

func summarizeFindings(findings []securityFinding) (string, map[string]int) {
	summary := map[string]int{"low": 0, "medium": 0, "high": 0, "blocked": 0}
	for _, finding := range findings {
		summary[finding.Level]++
	}
	for _, level := range []string{"blocked", "high", "medium"} {
		if summary[level] > 0 {
			return level, summary
		}
	}
	return "low", summary
}

func scanInline(code string) securityScan {
	findings := scanSource(code, "main.py")
	risk, summary := summarizeFindings(findings)
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	encoder.SetEscapeHTML(false)
	// The field order and compact JSON encoding match the confirmation IDs
	// produced by the previous backend.
	_ = encoder.Encode(findings)
	message := "未发现明显风险。"
	if risk == "high" {
		message = "发现高风险项，运行前需要确认。"
	} else if risk == "medium" {
		message = "发现中等风险项，运行前需要确认。"
	}
	return securityScan{
		RunnerMode: "system_python", SecurityMode: "guarded",
		ID:        hashPrefix(strings.TrimSuffix(data.String(), "\n"), 16),
		RiskLevel: risk, Summary: summary, Findings: findings,
		ScannedAt: formatTime(time.Now()), Message: message,
	}
}

func formatTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func projectRiskMessage(risk string) string {
	switch risk {
	case "blocked":
		return "发现阻断风险，当前项目不可执行。"
	case "high":
		return "发现高风险项，仅运行可信项目并确认风险。"
	case "medium":
		return "发现中等风险项，运行前需要确认。"
	case "low":
		return "未发现明显风险。"
	default:
		return fmt.Sprintf("未知风险级别：%s", risk)
	}
}
